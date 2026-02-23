// Types for Claude Agent SDK message protocol

export interface SystemInitEvent {
  type: 'system'
  subtype: 'init'
  session_id: string
  tools: string[]
  mcp_servers?: Record<string, unknown>[]
  model?: string
  claude_code_version?: string
}

export interface ContentBlockDelta {
  type: 'content_block_delta'
  index: number
  delta: {
    type: 'text_delta'
    text: string
  }
}

export interface ContentBlockStart {
  type: 'content_block_start'
  index: number
  content_block: {
    type: 'text' | 'tool_use'
    id?: string
    name?: string
    text?: string
  }
}

export interface ContentBlockStop {
  type: 'content_block_stop'
  index: number
}

export interface MessageStart {
  type: 'message_start'
  message: {
    id: string
    type: 'message'
    role: 'assistant'
    model: string
    usage: {
      input_tokens: number
      output_tokens: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
  }
}

export interface MessageDelta {
  type: 'message_delta'
  delta: {
    stop_reason: string
  }
  usage: {
    output_tokens: number
  }
}

export interface MessageStop {
  type: 'message_stop'
}

export type StreamSubEvent =
  | ContentBlockDelta
  | ContentBlockStart
  | ContentBlockStop
  | MessageStart
  | MessageDelta
  | MessageStop

export interface AssistantMessageEvent {
  type: 'assistant'
  message: {
    id: string
    type: 'message'
    role: 'assistant'
    content: Array<TextBlock | ToolUseBlock>
    model: string
    stop_reason: string
    usage: {
      input_tokens: number
      output_tokens: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
  }
  parent_tool_use_id?: string | null
  uuid?: string
  session_id: string
}

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResultEvent {
  type: 'tool_result'
  subtype?: string
  tool_use_id: string
  content: string | Array<{ type: 'text'; text: string }>
  is_error?: boolean
  uuid?: string
  session_id: string
}

export interface ResultEvent {
  type: 'result'
  subtype: 'success' | 'error'
  result?: string
  error?: string
  session_id: string
  cost_usd?: number
  duration_ms?: number
  duration_api_ms?: number
  is_error: boolean
  total_cost_usd?: number
  num_turns?: number
}

export interface StreamEvent {
  type: 'stream_event'
  event: StreamSubEvent
  parent_tool_use_id?: string | null
  uuid?: string
  session_id?: string
}

export type AgentEvent =
  | SystemInitEvent
  | StreamEvent
  | AssistantMessageEvent
  | ToolResultEvent
  | ResultEvent

// Input message format
export interface UserInputMessage {
  type: 'user_input'
  content: string
}
