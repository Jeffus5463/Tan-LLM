import { afterEach, describe, expect, it, vi } from "vitest";

import { streamOllamaChat } from "../src/generation/ollama.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function createStreamingResponse(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  let index = 0;

  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[index];

        if (chunk === undefined) {
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode(chunk));
        index += 1;
      },
    }),
  );
}

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return chunks;
}

describe("streamOllamaChat", () => {
  it("converts a split NDJSON response into text chunks", async () => {
    const response = createStreamingResponse([
      '{"message":{"content":"Hel',
      'lo"},"done":false}\n{"message":{"content":" world"},',
      '"done":false}\n{"message":{"content":""},"done":true}\n',
    ]);
    const fetchMock = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetchMock);
    const abortController = new AbortController();

    await expect(
      collect(
        streamOllamaChat({
          baseUrl: "http://ollama:11434/",
          model: "qwen3.5:4b",
          messages: [{ role: "user", content: "Hello" }],
          signal: abortController.signal,
        }),
      ),
    ).resolves.toEqual(["Hello", " world"]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://ollama:11434/api/chat");
    expect(request).toMatchObject({
      method: "POST",
      signal: abortController.signal,
      headers: {
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      model: "qwen3.5:4b",
      messages: [{ role: "user", content: "Hello" }],
      stream: true,
      think: false,
      options: {
        num_ctx: 8_192,
        num_predict: 2_048,
      },
    });
  });

  it("rejects an unavailable Ollama response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));

    await expect(
      collect(
        streamOllamaChat({
          baseUrl: "http://ollama:11434",
          model: "qwen3.5:4b",
          messages: [],
          signal: new AbortController().signal,
        }),
      ),
    ).rejects.toThrow("Ollama is unavailable.");
  });

  it("rejects malformed stream records", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        createStreamingResponse(['{"message":{},"done":false}\n']),
      ),
    );

    await expect(
      collect(
        streamOllamaChat({
          baseUrl: "http://ollama:11434",
          model: "qwen3.5:4b",
          messages: [],
          signal: new AbortController().signal,
        }),
      ),
    ).rejects.toThrow("Ollama returned an invalid chat stream.");
  });

  it("rejects a stream that closes before its completion record", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        createStreamingResponse([
          '{"message":{"content":"Partial"},"done":false}\n',
        ]),
      ),
    );

    await expect(
      collect(
        streamOllamaChat({
          baseUrl: "http://ollama:11434",
          model: "qwen3.5:4b",
          messages: [],
          signal: new AbortController().signal,
        }),
      ),
    ).rejects.toThrow("Ollama ended the chat stream unexpectedly.");
  });
});
