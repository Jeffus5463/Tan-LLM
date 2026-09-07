import { useEffect, useId, useRef, useState } from "react";

interface CopyResponseProps {
  content: string;
}

type CopyMode = "idle" | "copied" | "manual";

function clipboardIsAvailable(): boolean {
  return (
    window.isSecureContext &&
    typeof navigator.clipboard?.writeText === "function"
  );
}

export function CopyResponse({ content }: CopyResponseProps) {
  const [mode, setMode] = useState<CopyMode>("idle");
  const manualText = useRef<HTMLTextAreaElement>(null);
  const instructionsId = useId();
  const canCopy = clipboardIsAvailable();

  useEffect(() => {
    setMode("idle");
  }, [content]);

  useEffect(() => {
    if (mode === "manual") {
      manualText.current?.focus();
      manualText.current?.select();
    }
  }, [mode]);

  const copyOrSelect = async () => {
    if (!canCopy) {
      setMode("manual");
      return;
    }

    try {
      await navigator.clipboard.writeText(content);
      setMode("copied");
    } catch {
      setMode("manual");
    }
  };

  return (
    <div className="response-copy">
      <div className="response-copy__toolbar">
        <button
          className="response-copy__button"
          type="button"
          aria-label={canCopy ? "Copy response" : "Select response text"}
          onClick={() => void copyOrSelect()}
        >
          {mode === "copied" ? "Copied" : canCopy ? "Copy" : "Select text"}
        </button>
        <span className="visually-hidden" aria-live="polite">
          {mode === "copied" ? "Response copied to the clipboard." : ""}
        </span>
      </div>

      {mode === "manual" ? (
        <div className="manual-copy" role="region" aria-label="Manual copy">
          <label htmlFor={instructionsId}>Response text</label>
          <textarea
            id={instructionsId}
            ref={manualText}
            value={content}
            rows={6}
            readOnly
            aria-describedby={`${instructionsId}-help`}
          />
          <div className="manual-copy__footer">
            <p id={`${instructionsId}-help`}>
              The response is selected. Use your browser or device’s Copy command.
            </p>
            <button
              className="button button--quiet button--small"
              type="button"
              onClick={() => setMode("idle")}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
