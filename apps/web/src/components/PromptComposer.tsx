import type { FormEvent, KeyboardEvent } from "react";

import type { LocalGeneration } from "../chats/useConversation.js";

interface PromptComposerProps {
  chatId: string;
  value: string;
  disabled: boolean;
  generation: LocalGeneration | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
}

export function PromptComposer({
  chatId,
  value,
  disabled,
  generation,
  onChange,
  onSubmit,
  onStop,
}: PromptComposerProps) {
  const currentChatGenerating = generation?.chatId === chatId;
  const anotherChatGenerating = generation && !currentChatGenerating;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <div className="composer-area">
      {anotherChatGenerating ? (
        <p className="generation-notice" role="status">
          Your response in “{generation.chatTitle}” is still generating.
        </p>
      ) : null}
      <form className="prompt-composer" onSubmit={submit}>
        <label className="visually-hidden" htmlFor={`prompt-${chatId}`}>
          Message
        </label>
        <textarea
          id={`prompt-${chatId}`}
          value={value}
          rows={1}
          maxLength={16_000}
          placeholder="Message your local model"
          disabled={disabled || Boolean(generation)}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="composer-actions">
          <span className={value.length > 14_000 ? "character-count character-count--warning" : "character-count"}>
            {value.length.toLocaleString()} / 16,000
          </span>
          {currentChatGenerating ? (
            <button
              className="button button--danger composer-button"
              type="button"
              disabled={generation.phase === "stopping"}
              onClick={onStop}
            >
              {generation.phase === "stopping" ? "Stopping…" : "Stop"}
            </button>
          ) : (
            <button
              className="button button--primary composer-button"
              type="submit"
              disabled={disabled || Boolean(generation) || !value.trim()}
            >
              Send
            </button>
          )}
        </div>
      </form>
      <p className="composer-hint">Enter to send · Shift + Enter for a new line</p>
    </div>
  );
}
