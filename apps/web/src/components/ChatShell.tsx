import { useCallback, useEffect, useState, type FormEvent } from "react";

import type { ChatSummary } from "../api/client.js";
import { useChatWorkspace } from "../chats/useChatWorkspace.js";
import { useConversation } from "../chats/useConversation.js";
import { useVisiblePolling } from "../shared/useVisiblePolling.js";
import { Brand } from "./Brand.js";
import { MessageThread } from "./MessageThread.js";
import { PromptComposer } from "./PromptComposer.js";

interface ChatShellProps {
  username: string;
  logoutPending: boolean;
  message?: string;
  onLogout: () => Promise<void>;
  onSessionExpired: () => void;
}

interface ConversationListProps {
  chats: ChatSummary[];
  selectedChatId: string | null;
  loading: boolean;
  onSelect: (chatId: string) => void;
}

function ConversationList({
  chats,
  selectedChatId,
  loading,
  onSelect,
}: ConversationListProps) {
  if (loading) {
    return <p className="conversation-list__status">Loading conversations…</p>;
  }

  if (chats.length === 0) {
    return (
      <div className="conversation-list__empty">
        <span aria-hidden="true">•••</span>
        <p>No shared conversations yet.</p>
      </div>
    );
  }

  return (
    <div className="conversation-list__items">
      {chats.map((chat) => (
        <button
          className={`conversation-item${
            chat.id === selectedChatId ? " conversation-item--active" : ""
          }`}
          type="button"
          aria-current={chat.id === selectedChatId ? "page" : undefined}
          key={chat.id}
          onClick={() => onSelect(chat.id)}
        >
          <strong>{chat.title}</strong>
          <span>{chat.model}</span>
        </button>
      ))}
    </div>
  );
}

export function ChatShell({
  username,
  logoutPending,
  message: sessionMessage,
  onLogout,
  onSessionExpired,
}: ChatShellProps) {
  const workspace = useChatWorkspace(onSessionExpired);
  const conversation = useConversation({
    chat: workspace.selectedChat,
    onChatUpdated: workspace.applyChatUpdate,
    onSessionExpired,
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const selectedChatId = workspace.selectedChat?.id ?? null;
  const localGenerationChatId = conversation.generation?.chatId ?? null;
  const activeGenerationChatId =
    localGenerationChatId ?? workspace.status?.activeGeneration?.chatId ?? null;

  const synchronizeSharedState = useCallback(async () => {
    await Promise.all([
      workspace.synchronize(localGenerationChatId),
      conversation.synchronizeSelectedConversation(),
    ]);
  }, [
    conversation.synchronizeSelectedConversation,
    localGenerationChatId,
    workspace.synchronize,
  ]);

  useVisiblePolling(synchronizeSharedState);

  useEffect(() => {
    setRenaming(false);
    setDraftTitle(workspace.selectedChat?.title ?? "");
  }, [selectedChatId, workspace.selectedChat?.title]);

  const selectChat = (chatId: string) => {
    workspace.selectChat(chatId);
    setSidebarOpen(false);
  };

  const submitRename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (await workspace.renameChat(draftTitle)) {
      setRenaming(false);
    }
  };

  const confirmDelete = async () => {
    const chat = workspace.selectedChat;

    if (!chat) {
      return;
    }

    const confirmed = window.confirm(
      `Delete "${chat.title}"? This removes it from the shared household history.`,
    );

    if (confirmed) {
      await workspace.deleteChat();
    }
  };

  const createConversation = async () => {
    await workspace.createChat();
    setSidebarOpen(false);
  };

  const updateDraft = (value: string) => {
    if (!selectedChatId) {
      return;
    }

    setDrafts((current) => ({ ...current, [selectedChatId]: value }));
  };

  const submitPrompt = () => {
    if (!selectedChatId) {
      return;
    }

    const content = drafts[selectedChatId] ?? "";

    void conversation.sendMessage(content, () => {
      setDrafts((current) => ({ ...current, [selectedChatId]: "" }));
    });
  };

  const currentModelMissing =
    workspace.selectedChat !== null &&
    !workspace.models.includes(workspace.selectedChat.model);
  const modelOptions =
    currentModelMissing && workspace.selectedChat
      ? [workspace.selectedChat.model, ...workspace.models]
      : workspace.models;
  const actionPending = workspace.pendingAction !== null;
  const selectedChatGenerating = activeGenerationChatId === selectedChatId;
  const selectedActionBlocked = actionPending || selectedChatGenerating;
  const displayedMessage =
    sessionMessage ?? workspace.message ?? conversation.message;
  const dismissDisplayedMessage = workspace.message
    ? workspace.clearMessage
    : conversation.clearMessage;

  return (
    <div className="app-shell">
      {sidebarOpen ? (
        <button
          className="sidebar-backdrop"
          type="button"
          aria-label="Close conversations"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <aside
        className={`sidebar${sidebarOpen ? " sidebar--open" : ""}`}
        id="conversation-sidebar"
      >
        <div className="sidebar__header">
          <div>
            <Brand compact />
            <p>Household workspace</p>
          </div>
          <button
            className="icon-button sidebar__close"
            type="button"
            aria-label="Close conversations"
            onClick={() => setSidebarOpen(false)}
          >
            ×
          </button>
        </div>

        <button
          className="new-conversation"
          type="button"
          disabled={actionPending}
          onClick={() => void createConversation()}
        >
          <span aria-hidden="true">+</span>
          {workspace.pendingAction === "create"
            ? "Creating…"
            : "New conversation"}
        </button>

        <nav className="conversation-list" aria-label="Shared conversations">
          <div className="conversation-list__heading">
            <span>Conversations</span>
            <span className="conversation-count">{workspace.chats.length}</span>
          </div>
          <ConversationList
            chats={workspace.chats}
            selectedChatId={selectedChatId}
            loading={workspace.phase === "loading"}
            onSelect={selectChat}
          />
        </nav>

        <div className="sidebar__account">
          <div className="account-details">
            <span className="account-avatar" aria-hidden="true">
              {username.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <small>Signed in as</small>
              <strong>{username}</strong>
            </span>
          </div>
          <button
            className="button button--quiet"
            type="button"
            disabled={logoutPending}
            onClick={() => void onLogout()}
          >
            {logoutPending ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header>
          <div className="workspace__mobile-brand">
            <button
              className="icon-button workspace__menu"
              type="button"
              aria-label="Open conversations"
              aria-controls="conversation-sidebar"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(true)}
            >
              ☰
            </button>
            <Brand compact />
          </div>
        </header>

        {displayedMessage ? (
          <div className="shell-message" role="alert">
            <span>{displayedMessage}</span>
            {!sessionMessage ? (
              <button
                type="button"
                aria-label="Dismiss message"
                onClick={dismissDisplayedMessage}
              >
                ×
              </button>
            ) : null}
          </div>
        ) : null}

        {workspace.phase === "error" ? (
          <section
            className="workspace__state"
            aria-labelledby="load-error-title"
          >
            <p className="eyebrow">Connection problem</p>
            <h1 id="load-error-title">Conversations are unavailable</h1>
            <p>The shared history could not be loaded from the laptop.</p>
            <button
              className="button button--primary"
              type="button"
              onClick={() => void workspace.refresh()}
            >
              Try again
            </button>
          </section>
        ) : workspace.selectedChat ? (
          <section className="conversation-workspace">
            <header className="conversation-header">
              <div className="conversation-heading">
                {renaming ? (
                  <form className="rename-form" onSubmit={submitRename}>
                    <label htmlFor="conversation-title">
                      Conversation title
                    </label>
                    <div>
                      <input
                        id="conversation-title"
                        value={draftTitle}
                        maxLength={120}
                        autoFocus
                        onChange={(event) => setDraftTitle(event.target.value)}
                      />
                      <button
                        className="button button--primary button--small"
                        type="submit"
                        disabled={selectedActionBlocked}
                      >
                        {workspace.pendingAction === "rename"
                          ? "Saving…"
                          : "Save"}
                      </button>
                      <button
                        className="button button--secondary button--small"
                        type="button"
                        disabled={selectedActionBlocked}
                        onClick={() => {
                          setRenaming(false);
                          setDraftTitle(workspace.selectedChat?.title ?? "");
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <p className="eyebrow">Shared conversation</p>
                    <h1>{workspace.selectedChat.title}</h1>
                  </>
                )}
              </div>

              {!renaming ? (
                <div className="conversation-actions">
                  <label className="model-picker">
                    <span>Model</span>
                    <select
                      value={workspace.selectedChat.model}
                      disabled={
                        actionPending ||
                        selectedChatGenerating ||
                        workspace.modelsPhase !== "ready" ||
                        workspace.models.length === 0
                      }
                      onChange={(event) =>
                        void workspace.changeModel(event.target.value)
                      }
                    >
                      {modelOptions.map((model) => (
                        <option value={model} key={model}>
                          {model}
                          {!workspace.models.includes(model)
                            ? " (unavailable)"
                            : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="button button--secondary button--small"
                    type="button"
                    disabled={selectedActionBlocked}
                    onClick={() => setRenaming(true)}
                  >
                    Rename
                  </button>
                  <button
                    className="button button--danger button--small"
                    type="button"
                    disabled={selectedActionBlocked}
                    onClick={() => void confirmDelete()}
                  >
                    {workspace.pendingAction === "delete"
                      ? "Deleting…"
                      : "Delete"}
                  </button>
                </div>
              ) : null}
            </header>

            {workspace.modelsPhase === "loading" ? (
              <p className="model-status">Checking installed models…</p>
            ) : workspace.modelsPhase === "unavailable" ? (
              <p className="model-status model-status--warning">
                Model availability could not be checked. Existing conversations
                remain accessible.
              </p>
            ) : workspace.models.length === 0 ? (
              <p className="model-status model-status--warning">
                No configured models are currently installed.
              </p>
            ) : null}

            {workspace.statusPhase === "unavailable" ? (
              <p className="model-status model-status--warning" role="status">
                Live household status is unavailable. Requests remain protected
                by the server.
              </p>
            ) : workspace.status?.services.ollama === "offline" ? (
              <p className="model-status model-status--warning" role="status">
                The local model service is offline.
              </p>
            ) : null}

            <MessageThread
              messages={conversation.detail?.messages ?? []}
              phase={
                conversation.phase === "idle" ? "loading" : conversation.phase
              }
              onRetry={conversation.loadConversation}
            />
            <PromptComposer
              chatId={workspace.selectedChat.id}
              value={drafts[workspace.selectedChat.id] ?? ""}
              disabled={
                conversation.phase !== "ready" ||
                workspace.modelsPhase !== "ready" ||
                workspace.status?.services.ollama === "offline" ||
                !workspace.models.includes(workspace.selectedChat.model)
              }
              generation={conversation.generation}
              activeGenerationChatId={activeGenerationChatId}
              onChange={updateDraft}
              onSubmit={submitPrompt}
              onStop={conversation.stopGeneration}
            />
          </section>
        ) : (
          <section
            className="workspace__welcome"
            aria-labelledby="welcome-heading"
          >
            <div className="welcome-mark" aria-hidden="true">
              T
            </div>
            <p className="eyebrow">Local conversations</p>
            <h1 id="welcome-heading">Your household workspace</h1>
            <p>
              Create the first conversation for your shared household history.
            </p>
            <button
              className="button button--primary welcome-action"
              type="button"
              disabled={actionPending}
              onClick={() => void createConversation()}
            >
              {workspace.pendingAction === "create"
                ? "Creating…"
                : "New conversation"}
            </button>
            <div className="privacy-note">
              <span className="privacy-note__dot" aria-hidden="true" />
              Messages stay within this local setup
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
