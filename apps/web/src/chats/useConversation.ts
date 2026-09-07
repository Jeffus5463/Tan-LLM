import { useCallback, useEffect, useRef, useState } from "react";

import { streamGeneration, type GenerationEvent } from "../api/generation.js";
import {
  ApiError,
  getChat,
  updateChat,
  type ChatDetail,
  type ChatMessage,
  type ChatSummary,
} from "../api/client.js";

type DetailPhase = "idle" | "loading" | "ready" | "error" | "missing";
type GenerationPhase = "starting" | "streaming" | "stopping";

export interface LocalGeneration {
  chatId: string;
  chatTitle: string;
  phase: GenerationPhase;
}

interface UseConversationOptions {
  chat: ChatSummary | null;
  onChatUpdated: (chat: ChatSummary) => void;
  onSessionExpired: () => void;
}

interface ActiveRequest {
  chatId: string;
  controller: AbortController;
}

function chatSummary(chat: ChatDetail): ChatSummary {
  const { messages: _messages, ...summary } = chat;

  return summary;
}

function titleFromPrompt(content: string): string {
  const normalized = content
    .split(/\r?\n/, 1)[0]
    ?.replace(/[#*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const title = normalized || "New chat";

  return title.length > 56 ? `${title.slice(0, 53).trimEnd()}…` : title;
}

function updateAssistantMessage(
  detail: ChatDetail | null,
  chatId: string,
  messageId: string,
  update: (message: ChatMessage) => ChatMessage,
): ChatDetail | null {
  if (!detail || detail.id !== chatId) {
    return detail;
  }

  return {
    ...detail,
    messages: detail.messages.map((message) =>
      message.id === messageId ? update(message) : message,
    ),
  };
}

function generationErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return "Someone else is using the model. Your message is still in the composer.";
    }

    if (error.status === 404) {
      return "This conversation was deleted from another device.";
    }

    if (error.status === 400) {
      return "The message could not be submitted. Review it and try again.";
    }

    if (error.status === 0) {
      return "The local service could not be reached. Your message was not cleared.";
    }
  }

  return "The response was interrupted. Any saved partial response remains in the conversation.";
}

export function useConversation({
  chat,
  onChatUpdated,
  onSessionExpired,
}: UseConversationOptions) {
  const [detail, setDetail] = useState<ChatDetail | null>(null);
  const [phase, setPhase] = useState<DetailPhase>(
    chat ? "loading" : "idle",
  );
  const [message, setMessage] = useState<string>();
  const [generation, setGeneration] = useState<LocalGeneration | null>(null);
  const activeRequest = useRef<ActiveRequest | null>(null);
  const detailRequest = useRef(0);
  const selectedChatId = chat?.id ?? null;
  const selectedChatIdRef = useRef(selectedChatId);
  selectedChatIdRef.current = selectedChatId;

  const handleUnauthorized = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        onSessionExpired();
        return true;
      }

      return false;
    },
    [onSessionExpired],
  );

  const loadConversation = useCallback(async () => {
    const chatId = selectedChatId;
    const requestId = ++detailRequest.current;

    if (!chatId) {
      setDetail(null);
      setPhase("idle");
      return;
    }

    setPhase("loading");
    setMessage(undefined);

    try {
      const loadedChat = await getChat(chatId);

      if (
        detailRequest.current === requestId &&
        selectedChatIdRef.current === chatId
      ) {
        setDetail(loadedChat);
        setPhase("ready");
      }
    } catch (error) {
      if (
        detailRequest.current !== requestId ||
        selectedChatIdRef.current !== chatId
      ) {
        return;
      }

      if (handleUnauthorized(error)) {
        return;
      }

      if (error instanceof ApiError && error.status === 404) {
        setPhase("missing");
        setMessage("This conversation was deleted from another device.");
      } else {
        setPhase("error");
        setMessage("The conversation could not be loaded from the laptop.");
      }
    }
  }, [handleUnauthorized, selectedChatId]);

  useEffect(() => {
    void loadConversation();
  }, [loadConversation]);

  useEffect(
    () => () => {
      activeRequest.current?.controller.abort();
    },
    [],
  );

  const synchronizeConversation = useCallback(
    async (chatId: string) => {
      try {
        const loadedChat = await getChat(chatId);
        onChatUpdated(chatSummary(loadedChat));

        if (selectedChatIdRef.current === chatId) {
          setDetail(loadedChat);
          setPhase("ready");
        }
      } catch (error) {
        handleUnauthorized(error);
      }
    },
    [handleUnauthorized, onChatUpdated],
  );

  const sendMessage = useCallback(
    async (content: string, onAccepted: () => void) => {
      const selectedChat = chat;
      const currentDetail = detail;
      const trimmedContent = content.trim();

      if (
        !selectedChat ||
        !currentDetail ||
        currentDetail.id !== selectedChat.id ||
        phase !== "ready"
      ) {
        return;
      }

      if (!trimmedContent || trimmedContent.length > 16_000) {
        setMessage("Messages must contain between 1 and 16,000 characters.");
        return;
      }

      if (activeRequest.current) {
        setMessage("Wait for your current response to finish before sending another message.");
        return;
      }

      const controller = new AbortController();
      const chatId = selectedChat.id;
      const shouldCreateTitle =
        selectedChat.title === "New chat" && currentDetail.messages.length === 0;
      let assistantMessageId: string | null = null;
      let terminalEventReceived = false;
      let accepted = false;

      activeRequest.current = { chatId, controller };
      setGeneration({
        chatId,
        chatTitle: selectedChat.title,
        phase: "starting",
      });
      setMessage(undefined);

      const handleEvent = (event: GenerationEvent) => {
        if (event.type === "start") {
          accepted = true;
          assistantMessageId = event.messageId;
          onAccepted();

          const timestamp = new Date().toISOString();
          const nextSequence =
            (currentDetail.messages.at(-1)?.sequence ?? -1) + 1;

          setDetail((current) => {
            if (!current || current.id !== chatId) {
              return current;
            }

            return {
              ...current,
              messages: [
                ...current.messages,
                {
                  id: event.userMessageId,
                  sequence: nextSequence,
                  role: "user",
                  content: trimmedContent,
                  status: "complete",
                  createdAt: timestamp,
                  updatedAt: timestamp,
                },
                {
                  id: event.messageId,
                  sequence: nextSequence + 1,
                  role: "assistant",
                  content: "",
                  status: "streaming",
                  createdAt: timestamp,
                  updatedAt: timestamp,
                },
              ],
            };
          });
          setGeneration({
            chatId,
            chatTitle: selectedChat.title,
            phase: "streaming",
          });

          if (shouldCreateTitle) {
            const title = titleFromPrompt(trimmedContent);
            const localUpdate = {
              ...selectedChat,
              title,
              updatedAt: timestamp,
            };
            onChatUpdated(localUpdate);
            setGeneration((current) =>
              current ? { ...current, chatTitle: title } : current,
            );
            void updateChat(chatId, { title })
              .then(onChatUpdated)
              .catch((error: unknown) => {
                handleUnauthorized(error);
              });
          }

          return;
        }

        if (!assistantMessageId) {
          throw new ApiError(200, "The generation stream returned events out of order.");
        }

        if (event.type === "token") {
          setDetail((current) =>
            updateAssistantMessage(
              current,
              chatId,
              assistantMessageId as string,
              (assistant) => ({
                ...assistant,
                content: assistant.content + event.content,
                updatedAt: new Date().toISOString(),
              }),
            ),
          );
          return;
        }

        terminalEventReceived = true;
        const status =
          event.type === "completion"
            ? "complete"
            : event.type === "cancellation"
              ? "cancelled"
              : "error";

        setDetail((current) =>
          updateAssistantMessage(
            current,
            chatId,
            assistantMessageId as string,
            (assistant) => ({
              ...assistant,
              status,
              updatedAt: new Date().toISOString(),
            }),
          ),
        );

        if (event.type === "error") {
          setMessage("The model could not complete this response.");
        }
      };

      try {
        await streamGeneration({
          chatId,
          content: trimmedContent,
          signal: controller.signal,
          onEvent: handleEvent,
        });

        if (accepted && !terminalEventReceived && assistantMessageId) {
          setDetail((current) =>
            updateAssistantMessage(
              current,
              chatId,
              assistantMessageId as string,
              (assistant) => ({
                ...assistant,
                status: "interrupted",
                updatedAt: new Date().toISOString(),
              }),
            ),
          );
          setMessage("The response stream ended unexpectedly.");
        }
      } catch (error) {
        if (controller.signal.aborted) {
          if (accepted && assistantMessageId) {
            setDetail((current) =>
              updateAssistantMessage(
                current,
                chatId,
                assistantMessageId as string,
                (assistant) => ({
                  ...assistant,
                  status: "cancelled",
                  updatedAt: new Date().toISOString(),
                }),
              ),
            );
          }
        } else if (!handleUnauthorized(error)) {
          setMessage(generationErrorMessage(error));

          if (accepted && assistantMessageId) {
            setDetail((current) =>
              updateAssistantMessage(
                current,
                chatId,
                assistantMessageId as string,
                (assistant) => ({
                  ...assistant,
                  status: "interrupted",
                  updatedAt: new Date().toISOString(),
                }),
              ),
            );
          }
        }
      } finally {
        if (activeRequest.current?.controller === controller) {
          activeRequest.current = null;
          setGeneration(null);
        }

        if (accepted) {
          await synchronizeConversation(chatId);
        }
      }
    },
    [
      chat,
      detail,
      handleUnauthorized,
      onChatUpdated,
      phase,
      synchronizeConversation,
    ],
  );

  const stopGeneration = useCallback(() => {
    const request = activeRequest.current;

    if (!request) {
      return;
    }

    setGeneration((current) =>
      current ? { ...current, phase: "stopping" } : current,
    );
    request.controller.abort();
  }, []);

  return {
    detail,
    phase,
    message,
    generation,
    loadConversation,
    sendMessage,
    stopGeneration,
    clearMessage: () => setMessage(undefined),
  };
}
