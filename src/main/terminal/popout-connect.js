#!/usr/bin/env node
// Connector script for ClaudeX terminal popout.
// Connects stdin/stdout to a Unix domain socket that proxies a shared PTY session.

const net = require('net')

const socketPath = process.argv[2]
if (!socketPath) {
  process.stderr.write('Usage: popout-connect.js <socket-path>\n')
  process.exit(1)
}

const client = net.connect(socketPath)

// Set stdin to raw mode so keypresses go through unprocessed
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true)
}
process.stdin.resume()

// Send terminal size as a resize marker: \x00 R cols(u16BE) rows(u16BE)
function sendResize() {
  const cols = process.stdout.columns || 80
  const rows = process.stdout.rows || 24
  const buf = Buffer.alloc(6)
  buf[0] = 0x00
  buf[1] = 0x52 // 'R'
  buf.writeUInt16BE(cols, 2)
  buf.writeUInt16BE(rows, 4)
  client.write(buf)
}

// Send initial size, then on every resize
sendResize()
process.stdout.on('resize', sendResize)

// Pipe stdin to socket, socket to stdout
process.stdin.pipe(client)
client.pipe(process.stdout)

function cleanup() {
  if (process.stdin.isTTY) {
    try { process.stdin.setRawMode(false) } catch { /* ignore */ }
  }
  client.destroy()
  process.exit(0)
}

client.on('end', cleanup)
client.on('error', cleanup)
process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
process.on('SIGHUP', cleanup)
