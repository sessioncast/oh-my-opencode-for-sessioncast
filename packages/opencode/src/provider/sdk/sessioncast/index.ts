/**
 * SessionCast provider for OpenCode.
 *
 * Routes LLM requests through a SessionCast WebSocket relay to a CLI agent
 * that has direct access to the underlying model (Claude Code, etc.).
 */

import type { LanguageModelV2 } from "@ai-sdk/provider"
import { NoSuchModelError } from "ai"
import { RelayClient } from "./relay-client"
import { SessionCastChatModel } from "./sessioncast-chat-model"

export interface SessionCastProviderSettings {
  relayUrl: string
  token: string
  machineId?: string
  agentId?: string
  label?: string
  requiredCapabilities?: string
  name?: string
}

export function createSessionCast(options: SessionCastProviderSettings) {
  const client = new RelayClient({
    relayUrl: options.relayUrl,
    token: options.token,
    machineId: options.machineId,
    agentId: options.agentId,
    label: options.label ?? "opencode",
    requiredCapabilities: options.requiredCapabilities,
  })

  const providerName = options.name ?? "sessioncast"

  const createModel = (modelId: string): LanguageModelV2 => {
    return new SessionCastChatModel(modelId, client, providerName)
  }

  const provider = function (modelId: string) {
    return createModel(modelId)
  }

  provider.languageModel = createModel
  provider.chat = createModel
  provider.textEmbeddingModel = (_modelId: string) => {
    throw new NoSuchModelError({ modelId: _modelId, modelType: "textEmbeddingModel" })
  }
  provider.imageModel = (_modelId: string) => {
    throw new NoSuchModelError({ modelId: _modelId, modelType: "imageModel" })
  }

  return provider
}
