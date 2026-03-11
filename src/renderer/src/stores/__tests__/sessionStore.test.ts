import { describe, it, expect, beforeEach } from 'vitest'
import { useSessionStore, sessionNeedsInput, UIMessage, UIToolUseMessage, UIToolResultMessage, UISystemMessage, UITextMessage } from '../sessionStore'
import { useUIStore } from '../uiStore'

const store = useSessionStore

function resetStore(): void {
  store.setState({
    sessions: {},
    activeSessionId: null,
    streamingThinkingText: {},
    streamingThinkingComplete: {},
    projectSessionMemory: {}
  })
}

beforeEach(resetStore)

// -- sessionNeedsInput (pure function) --

describe('sessionNeedsInput', () => {
  const base = {
    sessionId: 's1',
    projectPath: '/test',
    name: 'Test',
    streamingText: '',
    isStreaming: false,
    isProcessing: false,
    costUsd: 0,
    totalCostUsd: 0,
    numTurns: 0,
    model: null,
    claudeVersion: null,
    error: null,
    selectedModel: null,
    selectedEffort: 'high' as const,
    createdAt: 0,
    worktreePath: null,
    isWorktree: false,
    worktreeBranch: null,
    worktreeSessionId: null,
    isRestored: false,
    forkedFrom: null,
    forkChildren: null,
    forkLabel: null,
    isForkParent: false,
    sdkSkills: [],
    hasUnread: false,
    suggestion: null
  }

  it('returns false for empty messages', () => {
    expect(sessionNeedsInput({ ...base, messages: [] })).toBe(false)
  })

  it('returns false when processing', () => {
    const messages: UIMessage[] = [
      { id: 't1', role: 'assistant', type: 'tool_use', toolName: 'AskUserQuestion', toolId: 'tu1', input: {}, timestamp: 0 }
    ]
    expect(sessionNeedsInput({ ...base, messages, isProcessing: true })).toBe(false)
  })

  it('returns true for unanswered AskUserQuestion', () => {
    const messages: UIMessage[] = [
      { id: 't1', role: 'assistant', type: 'tool_use', toolName: 'AskUserQuestion', toolId: 'tu1', input: {}, timestamp: 0 }
    ]
    expect(sessionNeedsInput({ ...base, messages })).toBe(true)
  })

  it('returns true for unanswered ExitPlanMode', () => {
    const messages: UIMessage[] = [
      { id: 't1', role: 'assistant', type: 'tool_use', toolName: 'ExitPlanMode', toolId: 'tu1', input: {}, timestamp: 0 }
    ]
    expect(sessionNeedsInput({ ...base, messages })).toBe(true)
  })

  it('returns false when tool_use has a result', () => {
    const messages: UIMessage[] = [
      { id: 'tu1', role: 'assistant', type: 'tool_use', toolName: 'AskUserQuestion', toolId: 'tu1', input: {}, timestamp: 0 },
      { id: 'r1', role: 'tool', type: 'tool_result', toolUseId: 'tu1', content: 'answer', isError: false, timestamp: 1 }
    ]
    expect(sessionNeedsInput({ ...base, messages })).toBe(false)
  })

  it('returns false when user text appears after tool_use', () => {
    const messages: UIMessage[] = [
      { id: 'tu1', role: 'assistant', type: 'tool_use', toolName: 'AskUserQuestion', toolId: 'tu1', input: {}, timestamp: 0 },
      { id: 'u1', role: 'user', type: 'text', content: 'hello', timestamp: 1 }
    ]
    expect(sessionNeedsInput({ ...base, messages })).toBe(false)
  })

  it('returns false for non-question tool_use without result', () => {
    const messages: UIMessage[] = [
      { id: 'tu1', role: 'assistant', type: 'tool_use', toolName: 'Read', toolId: 'tu1', input: {}, timestamp: 0 }
    ]
    expect(sessionNeedsInput({ ...base, messages })).toBe(false)
  })

  it('returns true when question follows text', () => {
    const messages: UIMessage[] = [
      { id: 'txt1', role: 'assistant', type: 'text', content: 'Let me ask...', timestamp: 0 },
      { id: 'tu1', role: 'assistant', type: 'tool_use', toolName: 'AskUserQuestion', toolId: 'tu1', input: {}, timestamp: 1 }
    ]
    expect(sessionNeedsInput({ ...base, messages })).toBe(true)
  })
})

// -- Store actions --

describe('sessionStore', () => {
  describe('createSession', () => {
    it('creates a session and sets it active', () => {
      store.getState().createSession('/project', 'sess1')
      const state = store.getState()
      expect(state.sessions['sess1']).toBeDefined()
      expect(state.sessions['sess1'].projectPath).toBe('/project')
      expect(state.activeSessionId).toBe('sess1')
    })

    it('remembers project-session mapping', () => {
      store.getState().createSession('/project', 'sess1')
      expect(store.getState().projectSessionMemory['/project']).toBe('sess1')
    })
  })

  describe('replaceSessionId', () => {
    it('moves session to new id', () => {
      store.getState().createSession('/project', 'old')
      store.getState().replaceSessionId('old', 'new')
      const state = store.getState()
      expect(state.sessions['old']).toBeUndefined()
      expect(state.sessions['new']).toBeDefined()
      expect(state.sessions['new'].sessionId).toBe('new')
    })

    it('updates activeSessionId if it was the old id', () => {
      store.getState().createSession('/project', 'old')
      store.getState().replaceSessionId('old', 'new')
      expect(store.getState().activeSessionId).toBe('new')
    })

    it('preserves activeSessionId if different', () => {
      store.getState().createSession('/p1', 's1')
      store.getState().createSession('/p2', 's2')
      // active is now s2
      store.getState().replaceSessionId('s1', 's1-new')
      expect(store.getState().activeSessionId).toBe('s2')
    })

    it('does nothing for nonexistent id', () => {
      store.getState().createSession('/project', 's1')
      store.getState().replaceSessionId('nonexistent', 'new')
      expect(store.getState().sessions['s1']).toBeDefined()
      expect(store.getState().sessions['new']).toBeUndefined()
    })
  })

  describe('removeSession', () => {
    it('removes the session', () => {
      store.getState().createSession('/project', 's1')
      store.getState().removeSession('s1')
      expect(store.getState().sessions['s1']).toBeUndefined()
    })

    it('nulls activeSessionId if it was removed', () => {
      store.getState().createSession('/project', 's1')
      store.getState().removeSession('s1')
      expect(store.getState().activeSessionId).toBeNull()
    })

    it('keeps activeSessionId if different session removed', () => {
      store.getState().createSession('/p1', 's1')
      store.getState().createSession('/p2', 's2')
      store.getState().removeSession('s1')
      expect(store.getState().activeSessionId).toBe('s2')
    })
  })

  describe('addUserMessage', () => {
    it('appends a user text message', () => {
      store.getState().createSession('/project', 's1')
      store.getState().addUserMessage('s1', 'hello world')
      const msgs = store.getState().sessions['s1'].messages
      expect(msgs).toHaveLength(1)
      expect(msgs[0].role).toBe('user')
      expect(msgs[0].type).toBe('text')
      expect((msgs[0] as { content: string }).content).toBe('hello world')
    })
  })

  describe('processEvent', () => {
    beforeEach(() => {
      store.getState().createSession('/project', 's1')
    })

    it('handles assistant event with text blocks', () => {
      store.getState().processEvent('s1', {
        type: 'assistant',
        message: {
          id: 'msg1',
          model: 'claude-opus-4-6',
          content: [{ type: 'text', text: 'Hello!' }]
        }
      })
      const msgs = store.getState().sessions['s1'].messages
      expect(msgs).toHaveLength(1)
      expect(msgs[0].type).toBe('text')
      expect((msgs[0] as { content: string }).content).toBe('Hello!')
    })

    it('handles assistant event with tool_use blocks', () => {
      store.getState().processEvent('s1', {
        type: 'assistant',
        message: {
          id: 'msg1',
          content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { path: '/file' } }]
        }
      })
      const msgs = store.getState().sessions['s1'].messages
      expect(msgs).toHaveLength(1)
      expect(msgs[0].type).toBe('tool_use')
      expect((msgs[0] as UIToolUseMessage).toolName).toBe('Read')
    })

    it('handles assistant event with thinking blocks', () => {
      store.getState().processEvent('s1', {
        type: 'assistant',
        message: {
          id: 'msg1',
          content: [
            { type: 'thinking', thinking: 'Let me think...' },
            { type: 'text', text: 'Here is my answer' }
          ]
        }
      })
      const msgs = store.getState().sessions['s1'].messages
      expect(msgs).toHaveLength(2)
      expect(msgs[0].type).toBe('thinking')
      expect(msgs[1].type).toBe('text')
    })

    it('deduplicates messages by id', () => {
      // Process same event twice
      const event = {
        type: 'assistant',
        message: {
          id: 'msg1',
          content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: {} }]
        }
      }
      store.getState().processEvent('s1', event)
      store.getState().processEvent('s1', event)
      expect(store.getState().sessions['s1'].messages).toHaveLength(1)
    })

    it('handles tool_result with string content', () => {
      store.getState().processEvent('s1', {
        type: 'tool_result',
        tool_use_id: 'tu1',
        content: 'file contents here',
        is_error: false
      })
      const msgs = store.getState().sessions['s1'].messages
      expect(msgs).toHaveLength(1)
      expect(msgs[0].type).toBe('tool_result')
      expect((msgs[0] as UIToolResultMessage).content).toBe('file contents here')
    })

    it('handles tool_result with array content', () => {
      store.getState().processEvent('s1', {
        type: 'tool_result',
        tool_use_id: 'tu1',
        content: [
          { type: 'text', text: 'part1' },
          { type: 'text', text: 'part2' }
        ],
        is_error: false
      })
      const msgs = store.getState().sessions['s1'].messages
      expect((msgs[0] as UIToolResultMessage).content).toBe('part1\npart2')
    })

    it('handles tool_result with image data', () => {
      store.getState().processEvent('s1', {
        type: 'tool_result',
        tool_use_id: 'tu1',
        content: [
          { type: 'image', data: 'base64data', mimeType: 'image/png' }
        ],
        is_error: false
      })
      const msg = store.getState().sessions['s1'].messages[0] as UIToolResultMessage
      expect(msg.imageData).toHaveLength(1)
      expect(msg.imageData![0].mimeType).toBe('image/png')
    })

    it('handles result event', () => {
      store.getState().processEvent('s1', {
        type: 'result',
        cost_usd: 0.05,
        total_cost_usd: 0.10,
        num_turns: 3,
        is_error: false
      })
      const session = store.getState().sessions['s1']
      expect(session.costUsd).toBe(0.05)
      expect(session.totalCostUsd).toBe(0.10)
      expect(session.numTurns).toBe(3)
      expect(session.error).toBeNull()
    })

    it('handles result event with error', () => {
      store.getState().processEvent('s1', {
        type: 'result',
        is_error: true,
        error: 'Something failed'
      })
      expect(store.getState().sessions['s1'].error).toBe('Something failed')
    })

    it('handles stream_event message_start/stop', () => {
      store.getState().processEvent('s1', {
        type: 'stream_event',
        event: { type: 'message_start' }
      })
      expect(store.getState().sessions['s1'].isStreaming).toBe(true)

      store.getState().processEvent('s1', {
        type: 'stream_event',
        event: { type: 'message_stop' }
      })
      expect(store.getState().sessions['s1'].isStreaming).toBe(false)
    })

    it('handles stream_event text_delta', () => {
      store.getState().processEvent('s1', {
        type: 'stream_event',
        event: { type: 'message_start' }
      })
      store.getState().processEvent('s1', {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } }
      })
      store.getState().processEvent('s1', {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } }
      })
      expect(store.getState().sessions['s1'].streamingText).toBe('Hello world')
    })

    it('ignores events for nonexistent session', () => {
      // Should not throw
      store.getState().processEvent('nonexistent', { type: 'result', is_error: false })
    })
  })

  describe('setProcessing', () => {
    it('sets processing state', () => {
      store.getState().createSession('/project', 's1')
      store.getState().setProcessing('s1', true)
      expect(store.getState().sessions['s1'].isProcessing).toBe(true)
    })

    it('marks hasUnread when processing ends on non-active session', () => {
      store.getState().createSession('/p1', 's1')
      store.getState().createSession('/p2', 's2') // s2 becomes active
      store.getState().setProcessing('s1', true)
      store.getState().setProcessing('s1', false)
      expect(store.getState().sessions['s1'].hasUnread).toBe(true)
    })

    it('does not mark hasUnread on active session', () => {
      store.getState().createSession('/project', 's1')
      store.getState().setProcessing('s1', true)
      store.getState().setProcessing('s1', false)
      expect(store.getState().sessions['s1'].hasUnread).toBe(false)
    })

    it('clears suggestion when processing starts', () => {
      store.getState().createSession('/project', 's1')
      store.getState().setSuggestion('s1', 'predicted text')
      store.getState().setProcessing('s1', true)
      expect(store.getState().sessions['s1'].suggestion).toBeNull()
    })
  })

  describe('markAsForked', () => {
    it('sets fork metadata', () => {
      store.getState().createSession('/project', 's1')
      store.getState().markAsForked('s1', ['child1', 'child2'])
      const session = store.getState().sessions['s1']
      expect(session.isForkParent).toBe(true)
      expect(session.forkChildren).toEqual(['child1', 'child2'])
    })
  })

  describe('getSerializableSessions', () => {
    it('filters out sessions with no messages', () => {
      store.getState().createSession('/project', 's1')
      store.getState().createSession('/project', 's2')
      store.getState().addUserMessage('s1', 'hello')
      const serializable = store.getState().getSerializableSessions()
      expect(serializable).toHaveLength(1)
      expect(serializable[0].id).toBe('s1')
    })
  })

  describe('restoreSession', () => {
    it('reconstructs session from persisted data', () => {
      store.getState().restoreSession({
        id: 'restored1',
        projectPath: '/project',
        name: 'Restored',
        createdAt: 1000,
        totalCostUsd: 0.5,
        numTurns: 10,
        model: 'claude-opus-4-6'
      })
      const session = store.getState().sessions['restored1']
      expect(session).toBeDefined()
      expect(session.name).toBe('Restored')
      expect(session.isRestored).toBe(true)
      expect(session.totalCostUsd).toBe(0.5)
      expect(session.numTurns).toBe(10)
    })
  })

  describe('getLastSessionForProject', () => {
    it('returns memorized session', () => {
      store.getState().createSession('/project', 's1')
      store.getState().createSession('/project', 's2')
      store.getState().setActiveSession('s1')
      expect(store.getState().getLastSessionForProject('/project')).toBe('s1')
    })

    it('returns null for unknown project', () => {
      expect(store.getState().getLastSessionForProject('/unknown')).toBeNull()
    })
  })

  describe('markAsRead', () => {
    it('clears hasUnread', () => {
      store.getState().createSession('/p1', 's1')
      store.getState().createSession('/p2', 's2')
      store.getState().setProcessing('s1', true)
      store.getState().setProcessing('s1', false)
      expect(store.getState().sessions['s1'].hasUnread).toBe(true)
      store.getState().markAsRead('s1')
      expect(store.getState().sessions['s1'].hasUnread).toBe(false)
    })
  })

  describe('getSessionsForProject', () => {
    it('returns sessions sorted by createdAt', () => {
      store.getState().createSession('/project', 's1')
      store.getState().createSession('/project', 's2')
      store.getState().createSession('/other', 's3')
      const sessions = store.getState().getSessionsForProject('/project')
      expect(sessions).toHaveLength(2)
      expect(sessions[0].sessionId).toBe('s1')
      expect(sessions[1].sessionId).toBe('s2')
    })
  })

  describe('setWorktreeBranch', () => {
    it('sets the worktree branch name', () => {
      store.getState().createSession('/project', 's1')
      store.getState().setWorktreeBranch('s1', 'feature/test')
      expect(store.getState().sessions['s1'].worktreeBranch).toBe('feature/test')
    })

    it('does nothing for nonexistent session', () => {
      store.getState().setWorktreeBranch('nonexistent', 'main')
      expect(store.getState().sessions['nonexistent']).toBeUndefined()
    })
  })

  describe('clearRestored', () => {
    it('clears isRestored flag', () => {
      store.getState().restoreSession({
        id: 'r1', projectPath: '/p', name: 'R', createdAt: 0
      })
      expect(store.getState().sessions['r1'].isRestored).toBe(true)
      store.getState().clearRestored('r1')
      expect(store.getState().sessions['r1'].isRestored).toBe(false)
    })

    it('does nothing for nonexistent session', () => {
      store.getState().clearRestored('nonexistent')
      // Should not throw
    })
  })

  describe('renameSession', () => {
    it('renames a session', () => {
      store.getState().createSession('/project', 's1')
      store.getState().renameSession('s1', 'My Chat')
      expect(store.getState().sessions['s1'].name).toBe('My Chat')
    })

    it('does nothing for nonexistent session', () => {
      store.getState().renameSession('nonexistent', 'name')
      // Should not throw
    })
  })

  describe('addSystemMessage', () => {
    it('appends a system message', () => {
      store.getState().createSession('/project', 's1')
      store.getState().addSystemMessage('s1', 'Session started')
      const msgs = store.getState().sessions['s1'].messages
      expect(msgs).toHaveLength(1)
      expect(msgs[0].role).toBe('system')
      expect(msgs[0].type).toBe('system')
      expect((msgs[0] as UISystemMessage).content).toBe('Session started')
    })

    it('does nothing for nonexistent session', () => {
      store.getState().addSystemMessage('nonexistent', 'test')
      // Should not throw
    })
  })

  describe('setError', () => {
    it('sets error on session', () => {
      store.getState().createSession('/project', 's1')
      store.getState().setError('s1', 'Something broke')
      expect(store.getState().sessions['s1'].error).toBe('Something broke')
    })

    it('clears error with null', () => {
      store.getState().createSession('/project', 's1')
      store.getState().setError('s1', 'err')
      store.getState().setError('s1', null)
      expect(store.getState().sessions['s1'].error).toBeNull()
    })

    it('does nothing for nonexistent session', () => {
      store.getState().setError('nonexistent', 'err')
    })
  })

  describe('setSelectedModel / setSelectedEffort', () => {
    it('sets selected model', () => {
      store.getState().createSession('/project', 's1')
      store.getState().setSelectedModel('s1', 'claude-sonnet-4-6')
      expect(store.getState().sessions['s1'].selectedModel).toBe('claude-sonnet-4-6')
    })

    it('sets selected effort', () => {
      store.getState().createSession('/project', 's1')
      store.getState().setSelectedEffort('s1', 'low')
      expect(store.getState().sessions['s1'].selectedEffort).toBe('low')
    })

    it('does nothing for nonexistent session', () => {
      store.getState().setSelectedModel('nonexistent', 'x')
      store.getState().setSelectedEffort('nonexistent', 'low')
    })
  })

  describe('setSuggestion', () => {
    it('sets suggestion text', () => {
      store.getState().createSession('/project', 's1')
      store.getState().setSuggestion('s1', 'try this')
      expect(store.getState().sessions['s1'].suggestion).toBe('try this')
    })

    it('clears suggestion with null', () => {
      store.getState().createSession('/project', 's1')
      store.getState().setSuggestion('s1', 'x')
      store.getState().setSuggestion('s1', null)
      expect(store.getState().sessions['s1'].suggestion).toBeNull()
    })

    it('does nothing for nonexistent session', () => {
      store.getState().setSuggestion('nonexistent', 'x')
    })
  })

  describe('setActiveSession', () => {
    it('sets null', () => {
      store.getState().createSession('/project', 's1')
      store.getState().setActiveSession(null)
      expect(store.getState().activeSessionId).toBeNull()
    })

    it('updates project memory', () => {
      store.getState().createSession('/p1', 's1')
      store.getState().createSession('/p1', 's2')
      store.getState().setActiveSession('s1')
      expect(store.getState().projectSessionMemory['/p1']).toBe('s1')
    })
  })

  describe('createSession with worktree options', () => {
    it('creates session with worktree path', () => {
      store.getState().createSession('/project', 's1', {
        worktreePath: '/wt/path',
        worktreeSessionId: 'wt-sess'
      })
      const session = store.getState().sessions['s1']
      expect(session.worktreePath).toBe('/wt/path')
      expect(session.isWorktree).toBe(true)
      expect(session.worktreeSessionId).toBe('wt-sess')
    })
  })

  describe('replaceSessionId with worktree options', () => {
    it('updates worktree fields on replace', () => {
      store.getState().createSession('/project', 'old')
      store.getState().replaceSessionId('old', 'new', {
        worktreePath: '/wt/new',
        worktreeSessionId: 'wt-new'
      })
      const session = store.getState().sessions['new']
      expect(session.worktreePath).toBe('/wt/new')
      expect(session.isWorktree).toBe(true)
      expect(session.worktreeSessionId).toBe('wt-new')
    })

    it('updates splitSessionId in UI store when it matches old id', () => {
      useUIStore.setState({ splitSessionId: 'old' })
      store.getState().createSession('/project', 'old')
      store.getState().replaceSessionId('old', 'new')
      expect(useUIStore.getState().splitSessionId).toBe('new')
    })
  })

  describe('addUserMessage with images', () => {
    it('attaches images to user message', () => {
      store.getState().createSession('/project', 's1')
      store.getState().addUserMessage('s1', 'look at this', [
        { path: '/img.png', previewUrl: 'data:image/png;base64,abc' }
      ])
      const msg = store.getState().sessions['s1'].messages[0] as UITextMessage
      expect(msg.images).toHaveLength(1)
      expect(msg.images![0].path).toBe('/img.png')
    })
  })

  describe('processEvent - system init', () => {
    beforeEach(() => {
      store.getState().createSession('/project', 's1')
    })

    it('handles system init with skills and slash commands', () => {
      store.getState().processEvent('s1', {
        type: 'system',
        subtype: 'init',
        session_id: 'real-id',
        claude_code_version: '1.2.3',
        skills: ['code-tree', 'commit'],
        slash_commands: ['commit', 'help']
      })
      const session = store.getState().sessions['s1']
      expect(session.claudeVersion).toBe('1.2.3')
      expect(session.isProcessing).toBe(true)
      // Deduplicates skills + slash_commands
      expect(session.sdkSkills).toEqual(['code-tree', 'commit', 'help'])
    })

    it('handles system init with no skills', () => {
      store.getState().processEvent('s1', {
        type: 'system',
        subtype: 'init',
        session_id: 's1'
      })
      const session = store.getState().sessions['s1']
      expect(session.sdkSkills).toEqual([])
      expect(session.isProcessing).toBe(true)
    })
  })

  describe('processEvent - stream thinking', () => {
    beforeEach(() => {
      store.getState().createSession('/project', 's1')
    })

    it('handles thinking content_block_start/delta/stop', () => {
      store.getState().processEvent('s1', {
        type: 'stream_event',
        event: { type: 'content_block_start', content_block: { type: 'thinking' } }
      })
      expect(store.getState().streamingThinkingText['s1']).toBe('')
      expect(store.getState().streamingThinkingComplete['s1']).toBe(false)

      store.getState().processEvent('s1', {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Hmm...' } }
      })
      expect(store.getState().streamingThinkingText['s1']).toBe('Hmm...')

      store.getState().processEvent('s1', {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: ' interesting' } }
      })
      expect(store.getState().streamingThinkingText['s1']).toBe('Hmm... interesting')

      store.getState().processEvent('s1', {
        type: 'stream_event',
        event: { type: 'content_block_stop' }
      })
      expect(store.getState().streamingThinkingComplete['s1']).toBe(true)
    })

    it('clears thinking state on message_stop', () => {
      store.setState({
        streamingThinkingText: { s1: 'thinking...' },
        streamingThinkingComplete: { s1: true }
      })
      store.getState().processEvent('s1', {
        type: 'stream_event',
        event: { type: 'message_stop' }
      })
      expect(store.getState().streamingThinkingText['s1']).toBeNull()
      expect(store.getState().streamingThinkingComplete['s1']).toBe(false)
    })
  })

  describe('processEvent - tool_result edge cases', () => {
    beforeEach(() => {
      store.getState().createSession('/project', 's1')
    })

    it('handles non-string non-array content', () => {
      store.getState().processEvent('s1', {
        type: 'tool_result',
        tool_use_id: 'tu1',
        content: 12345,
        is_error: false
      })
      const msg = store.getState().sessions['s1'].messages[0] as UIToolResultMessage
      expect(msg.content).toBe('12345')
    })

    it('handles error tool_result', () => {
      store.getState().processEvent('s1', {
        type: 'tool_result',
        tool_use_id: 'tu1',
        content: 'Error occurred',
        is_error: true
      })
      const msg = store.getState().sessions['s1'].messages[0] as UIToolResultMessage
      expect(msg.isError).toBe(true)
    })
  })

  describe('processEvent - assistant edge cases', () => {
    beforeEach(() => {
      store.getState().createSession('/project', 's1')
    })

    it('handles assistant event with no message', () => {
      store.getState().processEvent('s1', { type: 'assistant' })
      expect(store.getState().sessions['s1'].messages).toHaveLength(0)
    })

    it('handles assistant event with no content', () => {
      store.getState().processEvent('s1', {
        type: 'assistant',
        message: { id: 'msg1' }
      })
      expect(store.getState().sessions['s1'].messages).toHaveLength(0)
    })

    it('handles interleaved text and tool_use', () => {
      store.getState().processEvent('s1', {
        type: 'assistant',
        message: {
          id: 'msg1',
          content: [
            { type: 'text', text: 'First I will read' },
            { type: 'tool_use', id: 'tu1', name: 'Read', input: {} },
            { type: 'text', text: 'Now I will write' },
            { type: 'tool_use', id: 'tu2', name: 'Write', input: {} }
          ]
        }
      })
      const msgs = store.getState().sessions['s1'].messages
      expect(msgs).toHaveLength(4)
      expect(msgs[0].type).toBe('text')
      expect(msgs[1].type).toBe('tool_use')
      expect(msgs[2].type).toBe('text')
      expect(msgs[3].type).toBe('tool_use')
    })

    it('updates model from assistant message', () => {
      store.getState().processEvent('s1', {
        type: 'assistant',
        message: {
          id: 'msg1',
          model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text: 'hi' }]
        }
      })
      expect(store.getState().sessions['s1'].model).toBe('claude-sonnet-4-6')
    })
  })

  describe('processEvent - invalid/null events', () => {
    it('ignores null event', () => {
      store.getState().createSession('/project', 's1')
      store.getState().processEvent('s1', null)
      // Should not throw
    })

    it('ignores non-object event', () => {
      store.getState().createSession('/project', 's1')
      store.getState().processEvent('s1', 'not an object')
    })
  })

  describe('restoreSession - full fields', () => {
    it('restores with worktree and fork metadata', () => {
      store.getState().restoreSession({
        id: 'r1',
        projectPath: '/p',
        name: 'Fork A',
        createdAt: 1000,
        worktreePath: '/wt',
        isWorktree: true,
        worktreeSessionId: 'wt-sess',
        forkedFrom: 'parent1',
        forkLabel: 'A',
        forkChildren: ['c1', 'c2'],
        isForkParent: true,
        selectedModel: 'claude-sonnet-4-6',
        messages: [{ id: 'u1', role: 'user', type: 'text', content: 'hi', timestamp: 0 }]
      })
      const session = store.getState().sessions['r1']
      expect(session.worktreePath).toBe('/wt')
      expect(session.isWorktree).toBe(true)
      expect(session.worktreeSessionId).toBe('wt-sess')
      expect(session.forkedFrom).toBe('parent1')
      expect(session.forkLabel).toBe('A')
      expect(session.forkChildren).toEqual(['c1', 'c2'])
      expect(session.isForkParent).toBe(true)
      expect(session.selectedModel).toBe('claude-sonnet-4-6')
      expect(session.messages).toHaveLength(1)
    })

    it('uses defaults for missing optional fields', () => {
      store.getState().restoreSession({
        id: 'r2',
        projectPath: '/p',
        name: '',
        createdAt: 0
      })
      const session = store.getState().sessions['r2']
      expect(session.name).toBe('Session') // falsy name defaults
      expect(session.totalCostUsd).toBe(0)
      expect(session.numTurns).toBe(0)
      expect(session.model).toBeNull()
      expect(session.worktreePath).toBeNull()
      expect(session.isWorktree).toBe(false)
      expect(session.forkedFrom).toBeNull()
      expect(session.isForkParent).toBe(false)
    })
  })

  describe('getSerializableSessions - field mapping', () => {
    it('maps all fields correctly', () => {
      store.getState().createSession('/project', 's1')
      store.getState().addUserMessage('s1', 'hello')
      store.getState().markAsForked('s1', ['c1', 'c2'])
      const serialized = store.getState().getSerializableSessions()
      expect(serialized).toHaveLength(1)
      const s = serialized[0]
      expect(s.id).toBe('s1')
      expect(s.projectPath).toBe('/project')
      expect(s.messages).toHaveLength(1)
      expect(s.isForkParent).toBe(true)
      expect(s.forkChildren).toEqual(['c1', 'c2'])
      expect(s.lastActiveAt).toBeGreaterThan(0)
    })
  })

  describe('setProcessing - edge cases', () => {
    it('does nothing for nonexistent session', () => {
      store.getState().setProcessing('nonexistent', true)
      // Should not throw
    })
  })

  describe('markAsRead - edge cases', () => {
    it('no-ops when session is not unread', () => {
      store.getState().createSession('/project', 's1')
      const before = store.getState().sessions
      store.getState().markAsRead('s1')
      // State reference should be unchanged (no-op optimization)
      expect(store.getState().sessions).toBe(before)
    })
  })

  describe('markAsForked - edge cases', () => {
    it('does nothing for nonexistent session', () => {
      store.getState().markAsForked('nonexistent', ['a', 'b'])
    })
  })

  describe('getLastSessionForProject - fallback', () => {
    it('returns most recent when memory points to deleted session', () => {
      store.getState().createSession('/project', 's1')
      store.getState().createSession('/project', 's2')
      // Memory points to s2, but remove it
      store.getState().removeSession('s2')
      const last = store.getState().getLastSessionForProject('/project')
      expect(last).toBe('s1')
    })
  })
})
