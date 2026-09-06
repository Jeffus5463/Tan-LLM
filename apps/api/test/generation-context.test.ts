import { describe, expect, it } from "vitest";

import { trimConversationContext } from "../src/generation/context.js";

describe("trimConversationContext", () => {
  it("keeps the full conversation when it is within the limit", () => {
    const messages = [
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "Hi" },
    ];

    expect(trimConversationContext(messages, 7)).toEqual(messages);
  });

  it("keeps the newest contiguous messages within the limit", () => {
    const messages = [
      { role: "user" as const, content: "12345" },
      { role: "assistant" as const, content: "6789" },
      { role: "user" as const, content: "abc" },
    ];

    expect(trimConversationContext(messages, 7)).toEqual([
      { role: "assistant", content: "6789" },
      { role: "user", content: "abc" },
    ]);
  });

  it("does not mutate the supplied messages", () => {
    const message = { role: "user" as const, content: "Hello" };
    const result = trimConversationContext([message]);

    expect(result[0]).not.toBe(message);
    expect(result[0]).toEqual(message);
  });

  it.each([0, -1, 1.5])("rejects an invalid limit of %s", (limit) => {
    expect(() => trimConversationContext([], limit)).toThrow(
      "maximumCharacters must be a positive integer.",
    );
  });
});
