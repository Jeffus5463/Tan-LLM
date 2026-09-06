import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App authentication", () => {
  it("shows the login page when there is no active session", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Unauthorized" }, 401));
    vi.stubGlobal("fetch", fetchMock);

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
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ username: "owner" }));
    vi.stubGlobal("fetch", fetchMock);

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
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "Unauthorized" }, 401))
      .mockResolvedValueOnce(jsonResponse({ username: "owner" }));
    vi.stubGlobal("fetch", fetchMock);
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
    const [, loginOptions] = fetchMock.mock.calls[1] ?? [];
    expect(loginOptions).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      body: JSON.stringify({
        username: "owner",
        password: "test-password",
      }),
    });
  });

  it("shows the same safe message for invalid credentials", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "Unauthorized" }, 401))
      .mockResolvedValueOnce(
        jsonResponse({ error: "Invalid credentials" }, 401),
      );
    vi.stubGlobal("fetch", fetchMock);
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
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "Unauthorized" }, 401))
      .mockResolvedValueOnce(
        jsonResponse({ error: "Rate limit exceeded" }, 429),
      );
    vi.stubGlobal("fetch", fetchMock);
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
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse({ username: "owner" }));
    vi.stubGlobal("fetch", fetchMock);
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
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ username: "owner" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Sign out" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Welcome home" }),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/auth/logout",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
      }),
    );
  });
});
