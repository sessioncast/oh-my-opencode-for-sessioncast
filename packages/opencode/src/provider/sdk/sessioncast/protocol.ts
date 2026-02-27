/**
 * SessionCast WebSocket relay protocol types.
 */

export const MSG_REGISTER = "register"
export const MSG_PING = "ping"
export const MSG_PONG = "pong"
export const MSG_LLM_CHAT = "llm_chat"
export const MSG_API_RESPONSE = "api_response"
export const MSG_API_RESPONSE_STREAM = "api_response_stream"
export const MSG_CAPABILITY_RESULT = "capability_result"
export const MSG_ERROR = "error"
export const ROLE_HOST = "host"

export interface Message {
  type: string
  role?: string
  session?: string
  requiredCapabilities?: string
  meta?: {
    requestId?: string
    payload?: string
    error?: string
    label?: string
    machineId?: string
    token?: string
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface LlmChatRequest {
  model: string
  messages: ChatMessage[]
  max_tokens?: number
  temperature?: number
  stream?: boolean
}

export interface LlmChatResponse {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    message: { role: string; content: string }
    finish_reason: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  error?: { message: string; type?: string; code?: number }
}
