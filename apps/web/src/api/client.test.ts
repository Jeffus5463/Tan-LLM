import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  createChat,
  deleteChat,
  getSession,
  getStatus,
  listChats,
  listModels,
  updateChat,
} from "./client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API client", () => {
  it("preserves the server status and message for unsuccessful responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
        }),
      ),
    );

    const error = await getSession().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 401,
      message: "Unauthorized",
    });
  });

  it("reports invalid JSON instead of returning an unsafe value", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not-json", { status: 200 })),
    );

    const error = await getSession().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 200,
      message: "The server returned invalid data.",
    });
  });

  it("normalizes network failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("connection refused");
      }),
    );

    const error = await getSession().catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      status: 0,
      message: "The local service could not be reached.",
    });
  });

  it("uses the shared application endpoints", async () => {
    const chat = {
      id: "chat-1",
      title: "New chat",
      model: "qwen3.5:4b",
      createdAt: "2026-09-07T00:00:00.000Z",
      updatedAt: "2026-09-07T00:00:00.000Z",
    };
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const path = input.toString();

      if (path === "/api/chats" && init?.method === "POST") {
        return new Response(JSON.stringify({ chat }), { status: 201 });
      }

      if (path === "/api/chats") {
        return new Response(JSON.stringify({ chats: [chat] }));
      }

      if (path === "/api/chats/chat-1" && init?.method === "PATCH") {
        return new Response(
          JSON.stringify({ chat: { ...chat, title: "Renamed" } }),
        );
      }

      if (path === "/api/chats/chat-1" && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      if (path === "/api/models") {
        return new Response(
          JSON.stringify({
            defaultModel: "qwen3.5:4b",
            models: ["qwen3.5:4b"],
          }),
        );
      }

      if (path === "/api/status") {
        return new Response(
          JSON.stringify({
            services: { ollama: "available" },
            activeGeneration: null,
          }),
        );
      }

      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(listChats()).resolves.toEqual([chat]);
    await expect(createChat({ model: "qwen3.5:4b" })).resolves.toEqual(chat);
    await expect(updateChat("chat-1", { title: "Renamed" })).resolves.toMatchObject(
      { title: "Renamed" },
    );
    await expect(deleteChat("chat-1")).resolves.toBeUndefined();
    await expect(listModels()).resolves.toEqual({
      defaultModel: "qwen3.5:4b",
      models: ["qwen3.5:4b"],
    });
    await expect(getStatus()).resolves.toEqual({
      services: { ollama: "available" },
      activeGeneration: null,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chats/chat-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
