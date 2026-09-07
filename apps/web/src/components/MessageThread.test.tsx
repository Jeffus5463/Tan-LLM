import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "../api/client.js";
import { MessageThread } from "./MessageThread.js";

function message(
  id: string,
  role: ChatMessage["role"],
  status: ChatMessage["status"],
  content: string,
): ChatMessage {
  return {
    id,
    sequence: Number(id),
    role,
    content,
    status,
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z",
  };
}

describe("MessageThread response actions", () => {
  it("offers copying for finished assistant content only", () => {
    render(
      <MessageThread
        messages={[
          message("1", "user", "complete", "Household question"),
          message("2", "assistant", "complete", "Finished response"),
          message("3", "assistant", "streaming", "Partial response"),
        ]}
        phase="ready"
        onRetry={vi.fn(async () => undefined)}
      />,
    );

    expect(
      screen.getAllByRole("button", { name: /response/i }),
    ).toHaveLength(1);
  });

  it("keeps copy access for cancelled partial responses", () => {
    render(
      <MessageThread
        messages={[
          message("1", "assistant", "cancelled", "Useful partial response"),
        ]}
        phase="ready"
        onRetry={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByText("Stopped")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /response/i }),
    ).toBeTruthy();
  });
});
