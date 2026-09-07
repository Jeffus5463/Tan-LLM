import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarkdownMessage } from "./MarkdownMessage.js";

describe("MarkdownMessage", () => {
  it("renders Markdown and fenced code without injecting raw HTML", () => {
    const { container } = render(
      <MarkdownMessage
        content={[
          "**Local answer**",
          "",
          "~~~ts",
          "const answer = 42;",
          "~~~",
          "",
          "<script>window.unsafe = true</script>",
          "",
          "![diagram](https://example.com/diagram.png)",
        ].join("\n")}
      />,
    );

    expect(screen.getByText("Local answer").tagName).toBe("STRONG");
    expect(screen.getByText("const answer = 42;").tagName).toBe("CODE");
    expect(screen.getByText("[Image: diagram]")).toBeTruthy();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("does not preserve unsafe link protocols", () => {
    const { container } = render(
      <MarkdownMessage content="[unsafe](javascript:alert('x'))" />,
    );
    const link = container.querySelector("a");

    expect(link).not.toBeNull();
    expect(link?.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
    expect(link?.getAttribute("rel")).toBe("noreferrer");
  });
});
