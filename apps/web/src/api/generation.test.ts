import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./client.js";
import { streamGeneration, type GenerationEvent } from "./generation.js";

function eventStream(chunks: string[]): Response {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generation stream client", () => {
  it("parses events split across response chunks", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      eventStream([
        "event: start\ndata: {\"chatId\":\"chat-1\",\"userMessageId\":\"user-1\",",
        "\"messageId\":\"assistant-1\"}\n\nevent: token\ndata: {\"content\":\"Hello\"}\r\n\r\n",
        "event: completion\ndata: {\"messageId\":\"assistant-1\"}\n\n",
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const events: GenerationEvent[] = [];

    await streamGeneration({
      chatId: "chat-1",
      content: "Hello",
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event),
    });

    expect(events).toEqual([
      {
        type: "start",
        chatId: "chat-1",
        userMessageId: "user-1",
        messageId: "assistant-1",
      },
      { type: "token", content: "Hello" },
      { type: "completion", messageId: "assistant-1" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chats/chat-1/messages",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ content: "Hello" }),
      }),
    );
  });

  it("preserves a busy response as an API error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        new Response(JSON.stringify({ error: "Generation in progress" }), {
          status: 409,
        }),
      ),
    );

    const error = await streamGeneration({
      chatId: "chat-1",
      content: "Hello",
      signal: new AbortController().signal,
      onEvent: vi.fn(),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      message: "Generation in progress",
    });
  });

  it("rejects malformed event data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        eventStream(["event: token\ndata: {bad}\n\n"]),
      ),
    );

    const error = await streamGeneration({
      chatId: "chat-1",
      content: "Hello",
      signal: new AbortController().signal,
      onEvent: vi.fn(),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 200,
      message: "The generation stream returned invalid data.",
    });
  });
});
