/**
 * Lightweight session title generator using the Claude Agent SDK.
 * Fires a single-turn, tool-free query with Haiku to generate a short title.
 */

import { query } from '@anthropic-ai/claude-agent-sdk'
import { join } from 'path'
import { app } from 'electron'

export async function generateSessionTitle(userMessage: string): Promise<string | null> {
  // Truncate very long messages to save tokens
  const truncated = userMessage.length > 300 ? userMessage.slice(0, 300) + '...' : userMessage

  const prompt = `Generate a very short title (2-5 words, no quotes) for a coding session that starts with this message:\n\n${truncated}`

  try {
    const options: Record<string, any> = {
      model: 'claude-haiku-4-5-20251001',
      maxTurns: 1,
      tools: [],
      systemPrompt: 'You are a title generator. Respond with only a short title, nothing else.',
      persistSession: false,
      thinking: { type: 'disabled' },
    }

    if (app.isPackaged) {
      options.pathToClaudeCodeExecutable = join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        '@anthropic-ai',
        'claude-agent-sdk',
        'cli.js'
      )
    }

    let resultText: string | null = null

    for await (const message of query({ prompt, options })) {
      if (message.type === 'result' && message.subtype === 'success') {
        resultText = (message as any).result ?? null
      }
    }

    if (!resultText) return null

    // Clean up: remove quotes, limit length
    return resultText.replace(/^["']|["']$/g, '').trim().slice(0, 50)
  } catch (err) {
    console.warn('[TitleGenerator] Failed to generate title:', err)
    return null
  }
}
