import React, { useEffect, useRef, useState, useCallback } from 'react'
import type { UIMessage, UITextMessage, UIToolUseMessage, UIToolResultMessage } from '../../stores/sessionStore'
import MessageBubble from './MessageBubble'
import ToolUseBlock from './ToolUseBlock'
import ToolResultBlock from './ToolResultBlock'

interface ChatViewProps {
  terminalId: string
  claudeSessionId: string
  projectPath: string
}

interface SessionFileEntry {
  type: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  message?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

let nextId = 0
function uid(): string {
  return `cv-${Date.now()}-${nextId++}`
}

function entriesToMessages(entries: SessionFileEntry[]): UIMessage[] {
  const messages: UIMessage[] = []
  const now = Date.now()

  for (const entry of entries) {
    if (entry.type === 'user') {
      const msg = entry.message
      if (!msg) continue

      if (typeof msg.content === 'string') {
        messages.push({
          id: uid(),
          role: 'user',
          type: 'text',
          content: msg.content,
          timestamp: now
        } as UITextMessage)
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_result') {
            let text = ''
            if (typeof block.content === 'string') {
              text = block.content
            } else if (Array.isArray(block.content)) {
              text = block.content
                .filter((c: { type: string }) => c.type === 'text')
                .map((c: { text: string }) => c.text)
                .join('\n')
            }
            messages.push({
              id: uid(),
              role: 'tool',
              type: 'tool_result',
              toolUseId: block.tool_use_id || '',
              content: text,
              isError: block.is_error || false,
              timestamp: now
            } as UIToolResultMessage)
          } else if (block.type === 'text') {
            messages.push({
              id: uid(),
              role: 'user',
              type: 'text',
              content: block.text,
              timestamp: now
            } as UITextMessage)
          }
        }
      }
    } else if (entry.type === 'assistant') {
      const msg = entry.message
      if (!msg || !Array.isArray(msg.content)) continue

      let textAccum = ''
      for (const block of msg.content) {
        if (block.type === 'text') {
          textAccum += block.text
        } else if (block.type === 'tool_use') {
          if (textAccum) {
            messages.push({
              id: uid(),
              role: 'assistant',
              type: 'text',
              content: textAccum,
              timestamp: now
            } as UITextMessage)
            textAccum = ''
          }
          messages.push({
            id: uid(),
            role: 'assistant',
            type: 'tool_use',
            toolName: block.name || 'unknown',
            toolId: block.id || uid(),
            input: block.input || {},
            timestamp: now
          } as UIToolUseMessage)
        }
      }
      if (textAccum) {
        messages.push({
          id: uid(),
          role: 'assistant',
          type: 'text',
          content: textAccum,
          timestamp: now
        } as UITextMessage)
      }
    }
    // Skip system, progress, file-history-snapshot, etc.
  }

  return messages
}

export default function ChatView({ terminalId, claudeSessionId, projectPath }: ChatViewProps) {
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [inputText, setInputText] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Start watching on mount
  useEffect(() => {
    let cancelled = false

    const startWatch = async () => {
      console.log('[ChatView] starting watch:', { terminalId, claudeSessionId, projectPath })
      const result = await window.api.sessionFile.watch(terminalId, claudeSessionId, projectPath)
      console.log('[ChatView] watch result:', { success: result.success, entryCount: result.entries?.length })
      if (result.entries?.length) {
        console.log('[ChatView] first entry:', JSON.stringify(result.entries[0]).slice(0, 200))
        console.log('[ChatView] entry types:', result.entries.map((e: any) => e.type))
      }
      if (cancelled) return
      if (result.success && result.entries) {
        const msgs = entriesToMessages(result.entries)
        console.log('[ChatView] parsed messages:', msgs.length, msgs.map(m => ({ type: m.type, role: (m as any).role })))
        setMessages(msgs)
      }
    }

    startWatch()

    // Listen for incremental entries
    const unsub = window.api.sessionFile.onEntries((tid: string, entries: SessionFileEntry[]) => {
      console.log('[ChatView] onEntries:', { tid, terminalId, match: tid === terminalId, count: entries.length, types: entries.map(e => e.type) })
      if (tid !== terminalId) return
      const newMsgs = entriesToMessages(entries)
      console.log('[ChatView] incremental messages:', newMsgs.length)
      if (newMsgs.length > 0) {
        setMessages(prev => [...prev, ...newMsgs])
      }
    })

    // When the watcher switches to a new session file, replace all messages
    const unsubReset = window.api.sessionFile.onReset((tid: string, entries: SessionFileEntry[]) => {
      console.log('[ChatView] onReset:', { tid, terminalId, match: tid === terminalId, count: entries.length })
      if (tid !== terminalId) return
      setMessages(entriesToMessages(entries))
    })

    return () => {
      cancelled = true
      unsub()
      unsubReset()
      window.api.sessionFile.unwatch(terminalId)
    }
  }, [terminalId, claudeSessionId, projectPath])

  // Auto-scroll to bottom
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = useCallback(async () => {
    const text = inputText.trim()
    if (!text) return
    setInputText('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    // Write text first, then Enter separately with a delay
    // Claude Code's TUI processes input character-by-character
    await window.api.terminal.write(terminalId, text)
    await new Promise(r => setTimeout(r, 50))
    await window.api.terminal.write(terminalId, '\r')
  }, [inputText, terminalId])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value)
    // Auto-resize
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [])

  return (
    <div className="chat-view">
      <div className="chat-view-messages" ref={listRef}>
        <div className="messages-container">
          {messages.length === 0 ? (
            <div className="empty-state">
              <p>Waiting for messages...</p>
            </div>
          ) : (
            messages.map(msg => {
              if (msg.type === 'text') {
                return <MessageBubble key={msg.id} message={msg as UITextMessage} />
              } else if (msg.type === 'tool_use') {
                return <ToolUseBlock key={msg.id} message={msg as UIToolUseMessage} />
              } else if (msg.type === 'tool_result') {
                return <ToolResultBlock key={msg.id} message={msg as UIToolResultMessage} />
              }
              return null
            })
          )}
        </div>
      </div>
      <div className="chat-view-input-wrapper">
        <div className="input-bar">
          <textarea
            ref={textareaRef}
            className="input-textarea"
            placeholder="Send a message to Claude..."
            value={inputText}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            rows={1}
          />
          <div className="input-actions">
            <button
              className="btn-send"
              onClick={handleSend}
              disabled={!inputText.trim()}
              title="Send"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
