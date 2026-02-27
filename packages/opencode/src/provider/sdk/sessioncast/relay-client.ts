/**
 * SessionCast WebSocket relay client.
 */

import {
  type Message,
  type LlmChatRequest,
  type LlmChatResponse,
  MSG_REGISTER,
  MSG_PING,
  MSG_PONG,
  MSG_LLM_CHAT,
  MSG_API_RESPONSE,
  MSG_API_RESPONSE_STREAM,
  MSG_CAPABILITY_RESULT,
  MSG_ERROR,
  ROLE_HOST,
} from "./protocol"

const DEFAULT_PING_INTERVAL_MS = 30_000
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000

export interface RelayClientOptions {
  relayUrl: string
  token: string
  machineId?: string
  agentId?: string
  label?: string
  requiredCapabilities?: string
  pingIntervalMs?: number
  requestTimeoutMs?: number
}

interface PendingRequest {
  resolve: (value: { payload: string; error: string }) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
  streamCallback?: (chunk: { content: string; done: boolean }) => void
}

export class RelayClient {
  private ws: WebSocket | null = null
  private connected = false
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private pending = new Map<string, PendingRequest>()
  private opts: Required<Pick<RelayClientOptions, "relayUrl" | "token" | "pingIntervalMs" | "requestTimeoutMs">> &
    RelayClientOptions

  constructor(options: RelayClientOptions) {
    this.opts = {
      ...options,
      pingIntervalMs: options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS,
      requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    }
  }

  async connect(): Promise<void> {
    if (this.connected) return

    const url = new URL(this.opts.relayUrl)
    if (this.opts.token) {
      url.searchParams.set("token", this.opts.token)
    }

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url.toString())

      ws.addEventListener("open", () => {
        this.ws = ws
        this.connected = true
        this.startPingLoop()
        this.register()
        resolve()
      })

      ws.addEventListener("message", (event) => {
        this.handleRawMessage(event.data)
      })

      ws.addEventListener("close", () => {
        this.connected = false
        this.stopPingLoop()
      })

      ws.addEventListener("error", () => {
        if (!this.connected) {
          reject(new Error(`WebSocket connection failed: ${this.opts.relayUrl}`))
        }
      })
    })
  }

  disconnect(): void {
    if (!this.connected) return
    this.connected = false
    this.stopPingLoop()
    if (this.ws) {
      this.ws.close(1000, "client disconnect")
      this.ws = null
    }
  }

  get isConnected(): boolean {
    return this.connected
  }

  async llmChat(req: LlmChatRequest): Promise<LlmChatResponse> {
    if (!this.connected || !this.ws) {
      throw new Error("Client not connected")
    }

    const requestId = crypto.randomUUID()
    const payload = JSON.stringify(req)

    const responsePromise = this.registerRequest(requestId)

    this.sendMessage({
      type: MSG_LLM_CHAT,
      meta: { requestId, payload },
    })

    const resp = await responsePromise
    if (resp.error) throw new Error(resp.error)

    const chatResp: LlmChatResponse = JSON.parse(resp.payload)
    if (chatResp.error) throw new Error(chatResp.error.message)
    return chatResp
  }

  async llmChatStream(
    req: LlmChatRequest,
    onChunk: (chunk: { content: string; done: boolean }) => void,
  ): Promise<LlmChatResponse> {
    if (!this.connected || !this.ws) {
      throw new Error("Client not connected")
    }

    const requestId = crypto.randomUUID()
    const payload = JSON.stringify({ ...req, stream: true })

    const responsePromise = this.registerRequest(requestId, onChunk)

    this.sendMessage({
      type: MSG_LLM_CHAT,
      meta: { requestId, payload },
    })

    const resp = await responsePromise
    if (resp.error) throw new Error(resp.error)

    const chatResp: LlmChatResponse = JSON.parse(resp.payload)
    if (chatResp.error) throw new Error(chatResp.error.message)
    return chatResp
  }

  // --- private ---

  private registerRequest(
    requestId: string,
    streamCallback?: (chunk: { content: string; done: boolean }) => void,
  ): Promise<{ payload: string; error: string }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`Request ${requestId} timed out`))
      }, this.opts.requestTimeoutMs)

      this.pending.set(requestId, { resolve, reject, timer, streamCallback })
    })
  }

  private sendMessage(msg: Message): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not open")
    }
    this.ws.send(JSON.stringify(msg))
  }

  private register(): void {
    let session = this.opts.machineId ?? ""
    if (this.opts.agentId) {
      session = `api-${this.opts.agentId}`
    }

    this.sendMessage({
      type: MSG_REGISTER,
      role: ROLE_HOST,
      session,
      requiredCapabilities: this.opts.requiredCapabilities ?? "llm_chat",
      meta: {
        label: this.opts.label,
        machineId: this.opts.machineId,
        token: this.opts.token,
      },
    })
  }

  private handleRawMessage(data: unknown): void {
    try {
      const text = typeof data === "string" ? data : String(data)
      const msg: Message = JSON.parse(text)
      this.handleMessage(msg)
    } catch {
      // ignore unparseable messages
    }
  }

  private handleMessage(msg: Message): void {
    switch (msg.type) {
      case MSG_PING:
        this.sendMessage({ type: MSG_PONG })
        break

      case MSG_API_RESPONSE_STREAM: {
        if (msg.meta?.requestId) {
          const pending = this.pending.get(msg.meta.requestId)
          if (pending?.streamCallback && msg.meta.payload) {
            try {
              const chunk = JSON.parse(msg.meta.payload)
              pending.streamCallback(chunk)
            } catch {
              // ignore
            }
          }
        }
        break
      }

      case MSG_API_RESPONSE:
        if (msg.meta?.requestId) {
          const pending = this.pending.get(msg.meta.requestId)
          if (pending) {
            clearTimeout(pending.timer)
            this.pending.delete(msg.meta.requestId)
            pending.resolve({
              payload: msg.meta.payload ?? "",
              error: msg.meta.error ?? "",
            })
          }
        }
        break

      case MSG_CAPABILITY_RESULT:
      case MSG_ERROR:
        break
    }
  }

  private startPingLoop(): void {
    this.pingTimer = setInterval(() => {
      if (this.connected) {
        try {
          this.sendMessage({ type: MSG_PING })
        } catch {
          // ignore
        }
      }
    }, this.opts.pingIntervalMs)
  }

  private stopPingLoop(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }
}
