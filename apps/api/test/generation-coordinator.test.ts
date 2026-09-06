import { describe, expect, it } from "vitest";

import { GenerationCoordinator } from "../src/generation/coordinator.js";

describe("GenerationCoordinator", () => {
  it("starts without an active generation", () => {
    const coordinator = new GenerationCoordinator();

    expect(coordinator.getActiveGeneration()).toBeNull();
    expect(coordinator.isChatActive("chat-1")).toBe(false);
  });

  it("allows only one active generation", () => {
    const coordinator = new GenerationCoordinator();

    const lease = coordinator.tryAcquire({
      chatId: "chat-1",
      messageId: "message-1",
    });

    expect(lease?.generation).toEqual({
      chatId: "chat-1",
      messageId: "message-1",
    });
    expect(coordinator.getActiveGeneration()).toEqual({
      chatId: "chat-1",
      messageId: "message-1",
    });
    expect(coordinator.isChatActive("chat-1")).toBe(true);
    expect(coordinator.isChatActive("chat-2")).toBe(false);

    expect(
      coordinator.tryAcquire({
        chatId: "chat-2",
        messageId: "message-2",
      }),
    ).toBeNull();
  });

  it("releases the slot without allowing a stale lease to clear it", () => {
    const coordinator = new GenerationCoordinator();

    const firstLease = coordinator.tryAcquire({
      chatId: "chat-1",
      messageId: "message-1",
    });

    if (!firstLease) {
      throw new Error("The first generation lease was not acquired.");
    }

    firstLease.release();

    const secondLease = coordinator.tryAcquire({
      chatId: "chat-2",
      messageId: "message-2",
    });

    if (!secondLease) {
      throw new Error("The second generation lease was not acquired.");
    }

    firstLease.release();

    expect(coordinator.getActiveGeneration()).toEqual({
      chatId: "chat-2",
      messageId: "message-2",
    });

    secondLease.release();

    expect(coordinator.getActiveGeneration()).toBeNull();
  });
});
