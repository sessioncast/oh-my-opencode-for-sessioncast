/**
 * SessionCast chat language model implementing Vercel AI SDK LanguageModelV2.
 *
 * LLM requests are forwarded through a WebSocket relay to a CLI agent that
 * has direct access to the underlying model.
 */

import type {
  LanguageModelV2,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
  LanguageModelV2Prompt,
} from "@ai-sdk/provider"
import { generateId } from "@ai-sdk/provider-utils"
import type { ChatMessage, LlmChatRequest } from "./protocol"
import { RelayClient } from "./relay-client"

export class SessionCastChatModel implements LanguageModelV2 {
  readonly specificationVersion = "v2" as const
  readonly supportsStructuredOutputs = false

  readonly provider: string
  readonly modelId: string

  private client: RelayClient
  private connectPromise: Promise<void> | null = null

  constructor(modelId: string, client: RelayClient, provider = "sessioncast") {
    this.modelId = modelId
    this.client = client
    this.provider = provider
  }

  get supportedUrls(): Record<string, RegExp[]> {
    return {}
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.isConnected) return
    if (!this.connectPromise) {
      this.connectPromise = this.client.connect().finally(() => {
        this.connectPromise = null
      })
    }
    await this.connectPromise
  }

  // ── doGenerate ───────────────────────────────────────────────

  async doGenerate(
    options: Parameters<LanguageModelV2["doGenerate"]>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV2["doGenerate"]>>> {
    await this.ensureConnected()

    const chatMessages = convertPrompt(options.prompt)

    const req: LlmChatRequest = {
      model: "",
      messages: chatMessages,
      max_tokens: options.maxOutputTokens,
      temperature: options.temperature,
      stream: false,
    }

    const resp = await this.client.llmChat(req)

    const text = resp.choices?.[0]?.message?.content ?? ""
    const finishReason = mapFinishReason(resp.choices?.[0]?.finish_reason)

    const content: LanguageModelV2Content[] = []
    if (text) {
      content.push({ type: "text", text })
    }

    return {
      content,
      finishReason,
      usage: {
        inputTokens: resp.usage?.prompt_tokens ?? undefined,
        outputTokens: resp.usage?.completion_tokens ?? undefined,
        totalTokens: resp.usage?.total_tokens ?? undefined,
      },
      request: {
        body: JSON.stringify(req),
      },
      response: {
        id: resp.id,
        modelId: resp.model,
      },
      warnings: [],
    }
  }

  // ── doStream ─────────────────────────────────────────────────

  async doStream(
    options: Parameters<LanguageModelV2["doStream"]>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV2["doStream"]>>> {
    await this.ensureConnected()

    const chatMessages = convertPrompt(options.prompt)

    const req: LlmChatRequest = {
      model: "",
      messages: chatMessages,
      max_tokens: options.maxOutputTokens,
      temperature: options.temperature,
      stream: true,
    }

    const textId = generateId()

    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      start: async (controller) => {
        try {
          controller.enqueue({
            type: "stream-start",
            warnings: [],
          })

          let textStarted = false

          const resp = await this.client.llmChatStream(req, (chunk) => {
            if (chunk.content) {
              if (!textStarted) {
                controller.enqueue({ type: "text-start", id: textId })
                textStarted = true
              }
              controller.enqueue({
                type: "text-delta",
                id: textId,
                delta: chunk.content,
              })
            }
          })

          if (textStarted) {
            controller.enqueue({ type: "text-end", id: textId })
          }

          const finishReason = mapFinishReason(resp.choices?.[0]?.finish_reason)

          controller.enqueue({
            type: "finish",
            finishReason,
            usage: {
              inputTokens: resp.usage?.prompt_tokens ?? undefined,
              outputTokens: resp.usage?.completion_tokens ?? undefined,
              totalTokens: resp.usage?.total_tokens ?? undefined,
            },
          })
          controller.close()
        } catch (error) {
          controller.enqueue({
            type: "error",
            error: error instanceof Error ? error : new Error(String(error)),
          })
          controller.close()
        }
      },
    })

    return {
      stream,
      request: {
        body: JSON.stringify(req),
      },
    }
  }
}

// ── helpers ──────────────────────────────────────────────────

/**
 * Convert AI SDK V2 prompt messages into flat ChatMessage[] for the relay.
 */
function convertPrompt(prompt: LanguageModelV2Prompt): ChatMessage[] {
  const out: ChatMessage[] = []

  for (const msg of prompt) {
    switch (msg.role) {
      case "system":
        out.push({ role: "system", content: msg.content })
        break

      case "user": {
        const parts = msg.content
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
        if (parts.length > 0) {
          out.push({ role: "user", content: parts.join("\n") })
        }
        break
      }

      case "assistant": {
        let text = ""
        const toolCalls: { id: string; name: string; input: unknown }[] = []

        for (const part of msg.content) {
          if (part.type === "text") {
            text += part.text
          } else if (part.type === "tool-call") {
            toolCalls.push({
              id: part.toolCallId,
              name: part.toolName,
              input: part.input,
            })
          }
        }

        if (toolCalls.length > 0) {
          const callsJson = JSON.stringify(toolCalls)
          text = text ? `${text}\n\n[Tool Calls]\n${callsJson}` : `[Tool Calls]\n${callsJson}`
        }

        if (text) {
          out.push({ role: "assistant", content: text })
        }
        break
      }

      case "tool": {
        const parts = msg.content.map((r) => {
          let resultText: string
          if (r.output.type === "text" || r.output.type === "error-text") {
            resultText = r.output.value
          } else if (r.output.type === "json" || r.output.type === "error-json") {
            resultText = JSON.stringify(r.output.value)
          } else {
            resultText = JSON.stringify(r.output)
          }
          return `[Tool Result: ${r.toolName}]\n${resultText}`
        })
        if (parts.length > 0) {
          out.push({ role: "user", content: parts.join("\n\n") })
        }
        break
      }
    }
  }

  return out
}

function mapFinishReason(reason: string | undefined): LanguageModelV2FinishReason {
  switch (reason) {
    case "stop":
      return "stop"
    case "length":
      return "length"
    case "tool_calls":
    case "function_call":
      return "tool-calls"
    case "content_filter":
      return "content-filter"
    default:
      return "stop"
  }
}
