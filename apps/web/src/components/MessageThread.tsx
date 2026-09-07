import { useEffect, useRef } from "react";

import type { ChatMessage } from "../api/client.js";
import { CopyResponse } from "./CopyResponse.js";
import { MarkdownMessage } from "./MarkdownMessage.js";

interface MessageThreadProps {
  messages: ChatMessage[];
  phase: "loading" | "ready" | "error" | "missing";
  onRetry: () => Promise<void>;
}

const statusLabels: Partial<Record<ChatMessage["status"], string>> = {
  streaming: "Generating",
  cancelled: "Stopped",
  interrupted: "Interrupted",
  error: "Failed",
};

export function MessageThread({
  messages,
  phase,
  onRetry,
}: MessageThreadProps) {
  const endMarker = useRef<HTMLDivElement>(null);
  const lastMessage = messages.at(-1);

  useEffect(() => {
    endMarker.current?.scrollIntoView?.({ block: "end" });
  }, [lastMessage?.content, messages.length]);

  if (phase === "loading") {
    return (
      <div className="message-thread message-thread--state" role="status">
        <span className="thread-loader" aria-hidden="true" />
        <p>Loading conversation…</p>
      </div>
    );
  }

  if (phase === "error" || phase === "missing") {
    return (
      <div className="message-thread message-thread--state">
        <div className="welcome-mark" aria-hidden="true">
          !
        </div>
        <h2>
          {phase === "missing"
            ? "Conversation no longer available"
            : "Conversation unavailable"}
        </h2>
        <p>
          {phase === "missing"
            ? "It may have been deleted from another household device."
            : "The shared history could not be loaded from the laptop."}
        </p>
        <button
          className="button button--secondary"
          type="button"
          onClick={() => void onRetry()}
        >
          Try again
        </button>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="message-thread message-thread--state">
        <div className="welcome-mark" aria-hidden="true">
          T
        </div>
        <h2>Ready when you are</h2>
        <p>This shared conversation is available to everyone signed in at home.</p>
      </div>
    );
  }

  return (
    <div className="message-thread" aria-label="Conversation messages">
      <ol className="message-list">
        {messages.map((message) => {
          const statusLabel = statusLabels[message.status];

          return (
            <li className={`message message--${message.role}`} key={message.id}>
              <div className="message__avatar" aria-hidden="true">
                {message.role === "user" ? "You" : "T"}
              </div>
              <article className="message__content">
                <header>
                  <strong>{message.role === "user" ? "You" : "Tan LLM"}</strong>
                  {statusLabel ? (
                    <span className={`message-status message-status--${message.status}`}>
                      {statusLabel}
                    </span>
                  ) : null}
                </header>
                {message.role === "assistant" ? (
                  message.content ? (
                    <MarkdownMessage content={message.content} />
                  ) : message.status === "streaming" ? (
                    <span className="typing-indicator" role="status">
                      Thinking<span aria-hidden="true">…</span>
                    </span>
                  ) : (
                    <p className="empty-response">No response was produced.</p>
                  )
                ) : (
                  <p className="user-message">{message.content}</p>
                )}
                {message.role === "assistant" &&
                message.content &&
                message.status !== "streaming" ? (
                  <CopyResponse content={message.content} />
                ) : null}
              </article>
            </li>
          );
        })}
      </ol>
      <div ref={endMarker} />
    </div>
  );
}
