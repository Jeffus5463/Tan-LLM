import type { ConversationMessage } from "./context.js";

const OLLAMA_CONTEXT_TOKENS = 8_192;
const OLLAMA_OUTPUT_TOKENS = 2_048;

export interface OllamaChatRequest {
  baseUrl: string;
  model: string;
  messages: readonly ConversationMessage[];
  signal: AbortSignal;
}

export type StreamOllamaChat = (
  request: OllamaChatRequest,
) => AsyncIterable<string>;

interface OllamaChatChunk {
  message: {
    content: string;
  };
  done: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseChunk(line: string): OllamaChatChunk {
  const value: unknown = JSON.parse(line);

  if (
    !isRecord(value) ||
    typeof value.done !== "boolean" ||
    !isRecord(value.message) ||
    typeof value.message.content !== "string"
  ) {
    throw new Error("Ollama returned an invalid chat stream.");
  }

  return {
    message: {
      content: value.message.content,
    },
    done: value.done,
  };
}

export async function* streamOllamaChat(
  request: OllamaChatRequest,
): AsyncGenerator<string> {
  const response = await fetch(new URL("/api/chat", request.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: request.model,
      messages: request.messages,
      stream: true,
      think: false,
      options: {
        num_ctx: OLLAMA_CONTEXT_TOKENS,
        num_predict: OLLAMA_OUTPUT_TOKENS,
      },
    }),
    signal: request.signal,
  });

  if (!response.ok || !response.body) {
    throw new Error("Ollama is unavailable.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;

  try {
    while (!completed) {
      const result = await reader.read();
      buffer += decoder.decode(result.value, {
        stream: !result.done,
      });

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      if (result.done && buffer.trim()) {
        lines.push(buffer);
        buffer = "";
      }

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        const chunk = parseChunk(line);

        if (chunk.message.content) {
          yield chunk.message.content;
        }

        if (chunk.done) {
          completed = true;
          break;
        }
      }

      if (result.done) {
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!completed) {
    throw new Error("Ollama ended the chat stream unexpectedly.");
  }
}
