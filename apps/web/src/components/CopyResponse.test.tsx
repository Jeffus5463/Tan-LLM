import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CopyResponse } from "./CopyResponse.js";

const secureContextDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "isSecureContext",
);
const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);

function configureClipboard(
  secure: boolean,
  writeText?: (content: string) => Promise<void>,
): void {
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: secure,
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}

afterEach(() => {
  if (secureContextDescriptor) {
    Object.defineProperty(window, "isSecureContext", secureContextDescriptor);
  } else {
    Reflect.deleteProperty(window, "isSecureContext");
  }

  if (clipboardDescriptor) {
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  } else {
    Reflect.deleteProperty(navigator, "clipboard");
  }
});

describe("CopyResponse", () => {
  it("copies the original response in a secure browser context", async () => {
    const writeText = vi.fn(async () => undefined);
    const user = userEvent.setup();
    configureClipboard(true, writeText);
    render(<CopyResponse content="**Original** response" />);

    await user.click(screen.getByRole("button", { name: "Copy response" }));

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith("**Original** response");
    expect(screen.getByText("Response copied to the clipboard.")).toBeTruthy();
  });

  it("selects response text for manual copying on LAN HTTP", async () => {
    configureClipboard(false);
    const user = userEvent.setup();
    render(<CopyResponse content="Household response" />);

    await user.click(
      screen.getByRole("button", { name: "Select response text" }),
    );

    const textArea = screen.getByLabelText("Response text") as HTMLTextAreaElement;
    expect(textArea.value).toBe("Household response");
    expect(textArea.selectionStart).toBe(0);
    expect(textArea.selectionEnd).toBe(textArea.value.length);
    expect(document.activeElement).toBe(textArea);
  });

  it("falls back to manual selection when clipboard writing fails", async () => {
    const user = userEvent.setup();
    configureClipboard(true, async () => {
      throw new DOMException("Clipboard unavailable", "NotAllowedError");
    });
    render(<CopyResponse content="Fallback response" />);

    await user.click(screen.getByRole("button", { name: "Copy response" }));

    expect(
      await screen.findByRole("region", { name: "Manual copy" }),
    ).toBeTruthy();
    expect((screen.getByLabelText("Response text") as HTMLTextAreaElement).value).toBe(
      "Fallback response",
    );
  });
});
