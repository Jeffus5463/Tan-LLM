import { ApiError } from "./client.js";

export type GenerationEvent =
  | {
      type: "start";
      chatId: string;
      userMessageId: string;
      messageId: string;
    }
  | { type: "token"; content: string }
  | { type: "completion"; messageId: string }
  | { type: "cancellation"; messageId: string }
  | { type: "error"; messageId: string; message: string };

interface StreamGenerationOptions {
  chatId: string;
  content: string;
  signal: AbortSignal;
  onEvent: (event: GenerationEvent) => void;
}

interface ErrorPayload {
  error?: unknown;
}

function parseEventBlock(block: string): GenerationEvent | null {
  let eventType = "message";
  const dataLines: string[] = [];

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      eventType = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  let data: Record<string, unknown>;

  try {
    data = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
  } catch (error) {
    throw new ApiError(200, "The generation stream returned invalid data.", {
      cause: error,
    });
  }

  switch (eventType) {
    case "start":
      if (
        typeof data.chatId === "string" &&
        typeof data.userMessageId === "string" &&
        typeof data.messageId === "string"
      ) {
        return {
          type: "start",
          chatId: data.chatId,
          userMessageId: data.userMessageId,
          messageId: data.messageId,
        };
      }
      break;
    case "token":
      if (typeof data.content === "string") {
        return { type: "token", content: data.content };
      }
      break;
    case "completion":
    case "cancellation":
      if (typeof data.messageId === "string") {
        return { type: eventType, messageId: data.messageId };
      }
      break;
    case "error":
      if (
        typeof data.messageId === "string" &&
        typeof data.message === "string"
      ) {
        return {
          type: "error",
          messageId: data.messageId,
          message: data.message,
        };
      }
      break;
    default:
      return null;
  }

  throw new ApiError(200, "The generation stream returned invalid data.");
}

async function responseError(response: Response): Promise<ApiError> {
  let message = `Request failed with status ${response.status}.`;

  try {
    const payload = (await response.json()) as ErrorPayload;

    if (typeof payload.error === "string") {
      message = payload.error;
    }
  } catch {
    // Retain the status-based message when the response is not JSON.
  }

  return new ApiError(response.status, message);
}

export async function streamGeneration({
  chatId,
  content,
  signal,
  onEvent,
}: StreamGenerationOptions): Promise<void> {
  let response: Response;

  try {
    response = await fetch(
      `/api/chats/${encodeURIComponent(chatId)}/messages`,
      {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({ content }),
        signal,
      },
    );
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }

    throw new ApiError(0, "The local service could not be reached.", {
      cause: error,
    });
  }

  if (!response.ok) {
    throw await responseError(response);
  }

  if (!response.body) {
    throw new ApiError(200, "The generation stream did not start.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const result = await reader.read();

      if (result.done) {
        buffer += decoder.decode();
        break;
      }

      buffer += decoder.decode(result.value, { stream: true });

      while (true) {
        const boundary = buffer.search(/\r?\n\r?\n/);

        if (boundary === -1) {
          break;
        }

        const block = buffer.slice(0, boundary);
        const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0];
        buffer = buffer.slice(boundary + (separator?.length ?? 2));

        const event = parseEventBlock(block);

        if (event) {
          onEvent(event);
        }
      }
    }

    if (buffer.trim()) {
      const event = parseEventBlock(buffer.trim());

      if (event) {
        onEvent(event);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
