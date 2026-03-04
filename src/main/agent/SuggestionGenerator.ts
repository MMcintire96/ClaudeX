/**
 * Lightweight next-message suggestion generator using the Claude Agent SDK.
 * Fires a single-turn, tool-free query with Haiku to predict the user's next message.
 */

import { query } from '@anthropic-ai/claude-agent-sdk'
import { join } from 'path'
import { app } from 'electron'

export async function generateSuggestion(
  userMessage: string,
  assistantResult: string
): Promise<string | null> {
  const truncatedUser = userMessage.length > 500 ? userMessage.slice(0, 500) + '...' : userMessage
  const truncatedAssistant = assistantResult.length > 1000 ? assistantResult.slice(0, 1000) + '...' : assistantResult

  const prompt = `Given this coding conversation, predict what the user will type next as a follow-up message. The prediction should be a single short sentence (under 80 characters) that represents the most likely next request.

User's message:
${truncatedUser}

Assistant's response (summary):
${truncatedAssistant}

Respond with ONLY the predicted next message, nothing else. If there is no natural follow-up, respond with an empty string.`

  try {
    const options: Record<string, any> = {
      model: 'claude-haiku-4-5-20251001',
      maxTurns: 1,
      tools: [],
      systemPrompt:
        'You predict what a software developer will type next in a coding assistant conversation. ' +
        'Respond with only the predicted message text, nothing else. Keep predictions short, actionable, and relevant. ' +
        'Common patterns: asking to run tests, fix an error, add a feature, refactor code, explain something, commit changes.',
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
    const cleaned = resultText.replace(/^["']|["']$/g, '').trim()
    return cleaned.length > 0 && cleaned.length <= 120 ? cleaned : null
  } catch (err) {
    console.warn('[SuggestionGenerator] Failed to generate suggestion:', err)
    return null
  }
}
