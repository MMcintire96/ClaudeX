#!/usr/bin/env node
'use strict'

/**
 * Claude Codex MCP Server
 *
 * Self-contained MCP server (no external dependencies) that bridges
 * the Claude CLI's MCP protocol to the Codex bridge HTTP server.
 *
 * Environment variables:
 *   CODEX_BRIDGE_PORT  — bridge server port on localhost
 *   CODEX_BRIDGE_TOKEN — bearer token for auth
 *   CODEX_PROJECT_PATH — current project path
 *   CODEX_SESSION_ID   — this session's unique ID (for inter-session messaging)
 *
 * Protocol: newline-delimited JSON-RPC 2.0 on stdin/stdout
 */

const http = require('http')

const BRIDGE_PORT = process.env.CODEX_BRIDGE_PORT
const BRIDGE_TOKEN = process.env.CODEX_BRIDGE_TOKEN
const PROJECT_PATH = process.env.CODEX_PROJECT_PATH || ''
const SESSION_ID = process.env.CODEX_SESSION_ID || ''

if (!BRIDGE_PORT || !BRIDGE_TOKEN) {
  process.stderr.write('codex-mcp-server: CODEX_BRIDGE_PORT and CODEX_BRIDGE_TOKEN are required\n')
  process.exit(1)
}

// --- HTTP helper ---

function bridgeRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: parseInt(BRIDGE_PORT, 10),
      path: path,
      method: method,
      headers: {
        'Authorization': 'Bearer ' + BRIDGE_TOKEN,
        'Content-Type': 'application/json'
      }
    }

    const req = http.request(options, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8')
        try {
          resolve(JSON.parse(raw))
        } catch {
          resolve({ error: 'Invalid JSON from bridge: ' + raw.slice(0, 200) })
        }
      })
    })

    req.on('error', (err) => reject(err))

    if (body !== undefined) {
      const data = JSON.stringify(body)
      req.setHeader('Content-Length', Buffer.byteLength(data))
      req.write(data)
    }
    req.end()
  })
}

// --- MCP Tool definitions ---

const TOOLS = [
  {
    name: 'terminal_list',
    description: 'List all terminal sessions for the current project',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'terminal_read',
    description: 'Read recent output from a terminal (ANSI codes stripped). Returns the last N lines.',
    inputSchema: {
      type: 'object',
      properties: {
        terminalId: { type: 'string', description: 'Terminal ID (from terminal_list). If omitted, reads the first terminal.' },
        lines: { type: 'number', description: 'Number of lines to return (default 50, max 1000)' }
      },
      required: []
    }
  },
  {
    name: 'terminal_execute',
    description: 'Execute a command in the visible IDE terminal. The user sees the command and output in real-time.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        terminalId: { type: 'string', description: 'Terminal ID to use. If omitted, uses or creates the first terminal.' }
      },
      required: ['command']
    }
  },
  {
    name: 'browser_navigate',
    description: 'Navigate the IDE browser panel to a URL. The user sees the page load in real-time.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' }
      },
      required: ['url']
    }
  },
  {
    name: 'browser_url',
    description: 'Get the current URL of the IDE browser panel.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'browser_content',
    description: 'Read the visible text content of the current page in the IDE browser panel.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'browser_screenshot',
    description: 'Take a JPEG screenshot of the IDE browser panel viewport.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'session_list',
    description: 'List all Claude sessions running in the IDE for the current project. Use this to discover other sessions you can communicate with.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'session_send',
    description: 'Send a message to another Claude session. The recipient can read it with session_read. Use this to coordinate work, share findings, or delegate tasks between sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Session ID of the recipient (from session_list)' },
        content: { type: 'string', description: 'Message content to send' }
      },
      required: ['to', 'content']
    }
  },
  {
    name: 'session_read',
    description: 'Read messages sent to this session by other Claude sessions. Messages are cleared after reading by default.',
    inputSchema: {
      type: 'object',
      properties: {
        keep: { type: 'boolean', description: 'If true, messages are kept in the inbox instead of being cleared after reading (default: false)' }
      },
      required: []
    }
  }
]

// --- Tool execution ---

async function executeTool(name, args) {
  switch (name) {
    case 'terminal_list': {
      const result = await bridgeRequest('GET', '/terminal/list?projectPath=' + encodeURIComponent(PROJECT_PATH))
      return [{ type: 'text', text: JSON.stringify(result.terminals || [], null, 2) }]
    }

    case 'terminal_read': {
      // Resolve terminal ID
      let terminalId = args.terminalId
      if (!terminalId) {
        const listResult = await bridgeRequest('GET', '/terminal/list?projectPath=' + encodeURIComponent(PROJECT_PATH))
        const terminals = listResult.terminals || []
        if (terminals.length === 0) {
          return [{ type: 'text', text: 'No terminals open.' }]
        }
        terminalId = terminals[0].id
      }
      const lines = Math.min(args.lines || 50, 1000)
      const result = await bridgeRequest('GET', '/terminal/read?id=' + encodeURIComponent(terminalId) + '&lines=' + lines)
      if (result.error) {
        return [{ type: 'text', text: 'Error: ' + result.error }]
      }
      const output = (result.output || []).join('\n')
      return [{ type: 'text', text: output || '(no output)' }]
    }

    case 'terminal_execute': {
      const result = await bridgeRequest('POST', '/terminal/execute', {
        command: args.command,
        terminalId: args.terminalId,
        projectPath: PROJECT_PATH
      })
      if (result.error) {
        return [{ type: 'text', text: 'Error: ' + result.error }]
      }
      return [{ type: 'text', text: 'Command sent to terminal ' + result.terminalId }]
    }

    case 'browser_navigate': {
      const result = await bridgeRequest('POST', '/browser/navigate', { url: args.url })
      if (result.error) {
        return [{ type: 'text', text: 'Error: ' + result.error }]
      }
      return [{ type: 'text', text: 'Navigated to ' + args.url }]
    }

    case 'browser_url': {
      const result = await bridgeRequest('GET', '/browser/url')
      return [{ type: 'text', text: result.url || '(no browser open)' }]
    }

    case 'browser_content': {
      const result = await bridgeRequest('GET', '/browser/content')
      if (result.error) {
        return [{ type: 'text', text: 'Error: ' + result.error }]
      }
      return [{ type: 'text', text: result.content || '(empty page)' }]
    }

    case 'browser_screenshot': {
      const result = await bridgeRequest('GET', '/browser/screenshot')
      if (!result.data) {
        return [{ type: 'text', text: 'No screenshot available (browser may not be open)' }]
      }
      return [{ type: 'image', data: result.data, mimeType: 'image/jpeg' }]
    }

    // --- Inter-session messaging ---

    case 'session_list': {
      const result = await bridgeRequest('GET', '/sessions/list?projectPath=' + encodeURIComponent(PROJECT_PATH))
      const sessions = (result.sessions || [])
        .filter(function(s) { return s.id !== SESSION_ID }) // exclude self
        .map(function(s) { return { id: s.id, name: s.name } })
      const self = (result.sessions || []).find(function(s) { return s.id === SESSION_ID })
      const info = {
        yourSessionId: SESSION_ID,
        yourName: self ? self.name : SESSION_ID,
        otherSessions: sessions
      }
      return [{ type: 'text', text: JSON.stringify(info, null, 2) }]
    }

    case 'session_send': {
      if (!args.to || !args.content) {
        return [{ type: 'text', text: 'Error: "to" and "content" are required' }]
      }
      const result = await bridgeRequest('POST', '/sessions/send', {
        from: SESSION_ID,
        fromName: '',
        to: args.to,
        content: args.content
      })
      if (result.error) {
        return [{ type: 'text', text: 'Error: ' + result.error }]
      }
      return [{ type: 'text', text: 'Message sent to session ' + args.to }]
    }

    case 'session_read': {
      const clear = args.keep ? 'false' : 'true'
      const result = await bridgeRequest(
        'GET',
        '/sessions/read?sessionId=' + encodeURIComponent(SESSION_ID) + '&clear=' + clear
      )
      const messages = result.messages || []
      if (messages.length === 0) {
        return [{ type: 'text', text: 'No new messages.' }]
      }
      const formatted = messages.map(function(m) {
        const time = new Date(m.timestamp).toLocaleTimeString()
        return '[' + time + '] from ' + (m.fromName || m.from) + ':\n' + m.content
      }).join('\n\n---\n\n')
      return [{ type: 'text', text: formatted }]
    }

    default:
      throw new Error('Unknown tool: ' + name)
  }
}

// --- JSON-RPC / MCP protocol ---

function makeResponse(id, result) {
  return JSON.stringify({ jsonrpc: '2.0', id: id, result: result }) + '\n'
}

function makeError(id, code, message) {
  return JSON.stringify({ jsonrpc: '2.0', id: id, error: { code: code, message: message } }) + '\n'
}

async function handleMessage(msg) {
  const method = msg.method

  // Notifications (no id) — just acknowledge silently
  if (msg.id === undefined || msg.id === null) {
    return null
  }

  switch (method) {
    case 'initialize':
      return makeResponse(msg.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'codex-bridge', version: '1.0.0' }
      })

    case 'ping':
      return makeResponse(msg.id, {})

    case 'tools/list':
      return makeResponse(msg.id, { tools: TOOLS })

    case 'tools/call': {
      const toolName = msg.params && msg.params.name
      const toolArgs = (msg.params && msg.params.arguments) || {}
      try {
        const content = await executeTool(toolName, toolArgs)
        return makeResponse(msg.id, { content: content, isError: false })
      } catch (err) {
        return makeResponse(msg.id, {
          content: [{ type: 'text', text: 'Error: ' + (err.message || String(err)) }],
          isError: true
        })
      }
    }

    default:
      return makeError(msg.id, -32601, 'Method not found: ' + method)
  }
}

// --- Stdin line reader ---

let inputBuffer = ''

process.stdin.setEncoding('utf-8')
process.stdin.on('data', (chunk) => {
  inputBuffer += chunk
  let newlineIdx
  while ((newlineIdx = inputBuffer.indexOf('\n')) !== -1) {
    const line = inputBuffer.slice(0, newlineIdx).trim()
    inputBuffer = inputBuffer.slice(newlineIdx + 1)
    if (!line) continue

    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      process.stderr.write('codex-mcp-server: invalid JSON: ' + line.slice(0, 200) + '\n')
      continue
    }

    handleMessage(msg).then((response) => {
      if (response) {
        process.stdout.write(response)
      }
    }).catch((err) => {
      process.stderr.write('codex-mcp-server: handler error: ' + err.message + '\n')
      if (msg.id !== undefined && msg.id !== null) {
        process.stdout.write(makeError(msg.id, -32603, 'Internal error: ' + err.message))
      }
    })
  }
})

process.stdin.on('end', () => {
  process.exit(0)
})
