import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App.js";

interface ApiBehavior {
  session: Array<Response | Error>;
  login?: Response;
  logout?: Response;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function requestPath(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }

  return input instanceof URL ? input.toString() : input.url;
}

function createApiMock(behavior: ApiBehavior) {
  const sessionResults = [...behavior.session];
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const path = requestPath(input);

    if (path === "/api/auth/session") {
      const result = sessionResults.shift();

      if (result instanceof Error) {
        throw result;
      }

      return result ?? jsonResponse({ error: "Unauthorized" }, 401);
    }

    if (path === "/api/auth/login") {
      return behavior.login ?? jsonResponse({ error: "Unauthorized" }, 401);
    }

    if (path === "/api/auth/logout") {
      return behavior.logout ?? new Response(null, { status: 204 });
    }

    if (path === "/api/chats") {
      return jsonResponse({ chats: [] });
    }

    if (path === "/api/models") {
      return jsonResponse({
        defaultModel: "qwen3.5:4b",
        models: ["qwen3.5:4b"],
      });
    }

    return jsonResponse({ error: "Not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App authentication", () => {
  it("shows the login page when there is no active session", async () => {
    createApiMock({
      session: [jsonResponse({ error: "Unauthorized" }, 401)],
    });

    render(<App />);

    expect(screen.getByText("Connecting to your local workspace")).toBeTruthy();
    expect(
      await screen.findByRole("heading", { name: "Welcome home" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Username").getAttribute("autocomplete")).toBe(
      "username",
    );
    expect(screen.getByLabelText("Password").getAttribute("autocomplete")).toBe(
      "current-password",
    );
  });

  it("restores an existing session into the application shell", async () => {
    const fetchMock = createApiMock({
      session: [jsonResponse({ username: "owner" })],
    });

    render(<App />);

    expect(
      await screen.findByRole("heading", {
        name: "Your household workspace",
      }),
    ).toBeTruthy();
    expect(screen.getByText("owner")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/session",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("signs in with the shared household credentials", async () => {
    const fetchMock = createApiMock({
      session: [jsonResponse({ error: "Unauthorized" }, 401)],
      login: jsonResponse({ username: "owner" }),
    });
    const user = userEvent.setup();

    render(<App />);

    await user.type(await screen.findByLabelText("Username"), "owner");
    await user.type(screen.getByLabelText("Password"), "test-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByRole("heading", {
        name: "Your household workspace",
      }),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({
          username: "owner",
          password: "test-password",
        }),
      }),
    );
  });

  it("shows the same safe message for invalid credentials", async () => {
    createApiMock({
      session: [jsonResponse({ error: "Unauthorized" }, 401)],
      login: jsonResponse({ error: "Invalid credentials" }, 401),
    });
    const user = userEvent.setup();

    render(<App />);

    await user.type(await screen.findByLabelText("Username"), "owner");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "The username or password is incorrect.",
    );
    expect(
      (screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("explains when login has been rate-limited", async () => {
    createApiMock({
      session: [jsonResponse({ error: "Unauthorized" }, 401)],
      login: jsonResponse({ error: "Rate limit exceeded" }, 429),
    });
    const user = userEvent.setup();

    render(<App />);

    await user.type(await screen.findByLabelText("Username"), "owner");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Too many sign-in attempts. Try again in 15 minutes.",
    );
  });

  it("retries the session check when the local service returns", async () => {
    createApiMock({
      session: [
        new TypeError("fetch failed"),
        jsonResponse({ username: "owner" }),
      ],
    });
    const user = userEvent.setup();

    render(<App />);

    expect(
      await screen.findByRole("heading", {
        name: "Local service unavailable",
      }),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("heading", {
        name: "Your household workspace",
      }),
    ).toBeTruthy();
  });

  it("signs out and returns to the login page", async () => {
    const fetchMock = createApiMock({
      session: [jsonResponse({ username: "owner" })],
      logout: new Response(null, { status: 204 }),
    });
    const user = userEvent.setup();

    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Sign out" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Welcome home" }),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
      }),
    );
  });
});
