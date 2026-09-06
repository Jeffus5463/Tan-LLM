import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatSummary } from "../api/client.js";
import { ChatShell } from "./ChatShell.js";

const firstChat: ChatSummary = {
  id: "chat-1",
  title: "Kitchen plans",
  model: "qwen3.5:4b",
  createdAt: "2026-09-07T00:00:00.000Z",
  updatedAt: "2026-09-07T00:00:00.000Z",
};

const secondChat: ChatSummary = {
  id: "chat-2",
  title: "Weekend ideas",
  model: "qwen3.5:2b",
  createdAt: "2026-09-06T00:00:00.000Z",
  updatedAt: "2026-09-06T00:00:00.000Z",
};

interface TestApiOptions {
  initialChats?: ChatSummary[];
  modelsStatus?: number;
  patchStatus?: number;
  chatsStatus?: number;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestPath(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }

  return input instanceof URL ? input.toString() : input.url;
}

function createTestApi(options: TestApiOptions = {}) {
  let chats = [...(options.initialChats ?? [firstChat, secondChat])];
  let nextId = 3;

  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const path = requestPath(input);
    const method = init?.method ?? "GET";

    if (path === "/api/chats" && method === "GET") {
      if (options.chatsStatus) {
        return jsonResponse(
          { error: options.chatsStatus === 401 ? "Unauthorized" : "Unavailable" },
          options.chatsStatus,
        );
      }

      return jsonResponse({ chats });
    }

    if (path === "/api/models" && method === "GET") {
      if (options.modelsStatus) {
        return jsonResponse({ error: "Ollama unavailable" }, options.modelsStatus);
      }

      return jsonResponse({
        defaultModel: "qwen3.5:4b",
        models: ["qwen3.5:4b", "qwen3.5:2b"],
      });
    }

    if (path === "/api/chats" && method === "POST") {
      const inputBody = JSON.parse(String(init?.body)) as { model?: string };
      const chat: ChatSummary = {
        id: `chat-${nextId++}`,
        title: "New chat",
        model: inputBody.model ?? "qwen3.5:4b",
        createdAt: "2026-09-07T01:00:00.000Z",
        updatedAt: "2026-09-07T01:00:00.000Z",
      };
      chats = [chat, ...chats];
      return jsonResponse({ chat }, 201);
    }

    const chatId = path.startsWith("/api/chats/")
      ? decodeURIComponent(path.slice("/api/chats/".length))
      : null;
    const existingChat = chats.find((chat) => chat.id === chatId);

    if (chatId && method === "PATCH") {
      if (options.patchStatus) {
        return jsonResponse(
          { error: "Chat is currently generating" },
          options.patchStatus,
        );
      }

      const inputBody = JSON.parse(String(init?.body)) as {
        title?: string;
        model?: string;
      };
      const updatedChat = { ...existingChat, ...inputBody } as ChatSummary;
      chats = [updatedChat, ...chats.filter((chat) => chat.id !== chatId)];
      return jsonResponse({ chat: updatedChat });
    }

    if (chatId && method === "DELETE") {
      chats = chats.filter((chat) => chat.id !== chatId);
      return new Response(null, { status: 204 });
    }

    return jsonResponse({ error: "Not found" }, 404);
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderShell(onSessionExpired = vi.fn()) {
  render(
    <ChatShell
      username="owner"
      logoutPending={false}
      onLogout={vi.fn(async () => undefined)}
      onSessionExpired={onSessionExpired}
    />,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shared conversation management", () => {
  it("loads and selects shared conversations", async () => {
    createTestApi();
    const user = userEvent.setup();
    renderShell();

    expect(
      await screen.findByRole("heading", { name: "Kitchen plans" }),
    ).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
      "qwen3.5:4b",
    );

    await user.click(screen.getByRole("button", { name: /Weekend ideas/ }));

    expect(
      screen.getByRole("heading", { name: "Weekend ideas" }),
    ).toBeTruthy();
  });

  it("opens and closes the mobile conversation drawer", async () => {
    createTestApi();
    const user = userEvent.setup();
    renderShell();

    await screen.findByRole("heading", { name: "Kitchen plans" });
    const menuButton = screen.getByRole("button", {
      name: "Open conversations",
    });
    expect(menuButton.getAttribute("aria-expanded")).toBe("false");

    await user.click(menuButton);
    expect(menuButton.getAttribute("aria-expanded")).toBe("true");

    await user.click(
      screen.getAllByRole("button", { name: "Close conversations" })[0]!,
    );
    expect(menuButton.getAttribute("aria-expanded")).toBe("false");
  });

  it("creates a conversation with the default installed model", async () => {
    const fetchMock = createTestApi({ initialChats: [] });
    const user = userEvent.setup();
    renderShell();

    await screen.findByRole("heading", { name: "Your household workspace" });
    await user.click(
      screen.getAllByRole("button", { name: "New conversation" })[0]!,
    );

    expect(
      await screen.findByRole("heading", { name: "New chat" }),
    ).toBeTruthy();
    const createCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        requestPath(input) === "/api/chats" && init?.method === "POST",
    );
    expect(createCall?.[1]?.body).toBe(
      JSON.stringify({ model: "qwen3.5:4b" }),
    );
  });

  it("renames a conversation and changes its model", async () => {
    const fetchMock = createTestApi();
    const user = userEvent.setup();
    renderShell();

    await screen.findByRole("heading", { name: "Kitchen plans" });
    await user.click(screen.getByRole("button", { name: "Rename" }));
    const titleInput = screen.getByLabelText("Conversation title");
    await user.clear(titleInput);
    await user.type(titleInput, "Dinner notes");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByRole("heading", { name: "Dinner notes" }),
    ).toBeTruthy();

    await user.selectOptions(screen.getByRole("combobox"), "qwen3.5:2b");

    await waitFor(() => {
      expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
        "qwen3.5:2b",
      );
    });
    const patchBodies = fetchMock.mock.calls
      .filter(([, init]) => init?.method === "PATCH")
      .map(([, init]) => init?.body);
    expect(patchBodies).toEqual([
      JSON.stringify({ title: "Dinner notes" }),
      JSON.stringify({ model: "qwen3.5:2b" }),
    ]);
  });

  it("requires confirmation before deleting shared history", async () => {
    const confirmMock = vi
      .fn<() => boolean>()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    vi.stubGlobal("confirm", confirmMock);
    const fetchMock = createTestApi({ initialChats: [firstChat] });
    const user = userEvent.setup();
    renderShell();

    await screen.findByRole("heading", { name: "Kitchen plans" });
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(
      await screen.findByRole("heading", { name: "Your household workspace" }),
    ).toBeTruthy();
    expect(confirmMock).toHaveBeenCalledWith(
      expect.stringContaining("shared household history"),
    );
  });

  it("keeps conversations available when model discovery fails", async () => {
    createTestApi({ modelsStatus: 503 });
    renderShell();

    expect(
      await screen.findByRole("heading", { name: "Kitchen plans" }),
    ).toBeTruthy();
    expect(screen.getByText(/Model availability could not be checked/)).toBeTruthy();
    expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(
      true,
    );
  });

  it("shows a busy message when a model change is rejected", async () => {
    createTestApi({ patchStatus: 409 });
    const user = userEvent.setup();
    renderShell();

    await screen.findByRole("heading", { name: "Kitchen plans" });
    await user.selectOptions(screen.getByRole("combobox"), "qwen3.5:2b");

    expect((await screen.findByRole("alert")).textContent).toContain(
      "currently generating",
    );
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
      "qwen3.5:4b",
    );
  });

  it("returns to sign-in when the session has expired", async () => {
    createTestApi({ chatsStatus: 401 });
    const onSessionExpired = vi.fn();
    renderShell(onSessionExpired);

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledOnce());
  });
});
