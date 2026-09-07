import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ApiError,
  createChat as requestCreateChat,
  deleteChat as requestDeleteChat,
  getStatus,
  listChats,
  listModels,
  updateChat as requestUpdateChat,
  type ApplicationStatus,
  type ChatSummary,
} from "../api/client.js";

type LoadPhase = "loading" | "ready" | "error";
type ModelsPhase = "loading" | "ready" | "unavailable";
type StatusPhase = "loading" | "ready" | "unavailable";
type PendingAction = "create" | "rename" | "delete" | "model" | null;

interface ChatWorkspaceState {
  chats: ChatSummary[];
  selectedChat: ChatSummary | null;
  phase: LoadPhase;
  models: string[];
  modelsPhase: ModelsPhase;
  status: ApplicationStatus | null;
  statusPhase: StatusPhase;
  message?: string;
  pendingAction: PendingAction;
  selectChat: (chatId: string) => void;
  refresh: () => Promise<void>;
  synchronize: (preserveChatId?: string | null) => Promise<void>;
  createChat: () => Promise<void>;
  renameChat: (title: string) => Promise<boolean>;
  deleteChat: () => Promise<boolean>;
  changeModel: (model: string) => Promise<void>;
  clearMessage: () => void;
  applyChatUpdate: (chat: ChatSummary) => void;
}

function placeFirst(chats: ChatSummary[], updatedChat: ChatSummary) {
  return [updatedChat, ...chats.filter((chat) => chat.id !== updatedChat.id)];
}

function mergeSynchronizedChats(
  current: ChatSummary[],
  incoming: ChatSummary[],
  preserveChatId: string | null,
): ChatSummary[] {
  if (!preserveChatId) {
    return incoming;
  }

  const preservedChat = current.find((chat) => chat.id === preserveChatId);

  if (!preservedChat) {
    return incoming;
  }

  return incoming.map((chat) =>
    chat.id === preserveChatId ? preservedChat : chat,
  );
}

function actionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return "This conversation is currently generating. Try again when it finishes.";
    }

    if (error.status === 404) {
      return "This conversation was deleted from another device.";
    }

    if (error.status === 503 || error.status === 0) {
      return "The local service is unavailable. Check the laptop and try again.";
    }
  }

  return fallback;
}

export function useChatWorkspace(
  onSessionExpired: () => void,
): ChatWorkspaceState {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [models, setModels] = useState<string[]>([]);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [modelsPhase, setModelsPhase] = useState<ModelsPhase>("loading");
  const [status, setStatus] = useState<ApplicationStatus | null>(null);
  const [statusPhase, setStatusPhase] = useState<StatusPhase>("loading");
  const [message, setMessage] = useState<string>();
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

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

  const refresh = useCallback(async () => {
    setPhase("loading");
    setMessage(undefined);
    setModelsPhase("loading");
    setStatusPhase("loading");

    const [chatResult, modelResult, statusResult] = await Promise.allSettled([
      listChats(),
      listModels(),
      getStatus(),
    ]);

    if (
      (chatResult.status === "rejected" &&
        handleUnauthorized(chatResult.reason)) ||
      (modelResult.status === "rejected" &&
        handleUnauthorized(modelResult.reason)) ||
      (statusResult.status === "rejected" &&
        handleUnauthorized(statusResult.reason))
    ) {
      return;
    }

    if (chatResult.status === "rejected") {
      setPhase("error");
      setMessage(
        "Shared conversations could not be loaded. Check the local service and try again.",
      );
    } else {
      setChats(chatResult.value);
      setSelectedChatId((current) =>
        chatResult.value.some((chat) => chat.id === current)
          ? current
          : (chatResult.value[0]?.id ?? null),
      );
      setPhase("ready");
    }

    if (modelResult.status === "rejected") {
      setModels([]);
      setDefaultModel(null);
      setModelsPhase("unavailable");
    } else {
      setModels(modelResult.value.models);
      setDefaultModel(modelResult.value.defaultModel);
      setModelsPhase("ready");
    }

    if (statusResult.status === "rejected") {
      setStatus(null);
      setStatusPhase("unavailable");
    } else {
      setStatus(statusResult.value);
      setStatusPhase("ready");
    }
  }, [handleUnauthorized]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedChat = useMemo(
    () => chats.find((chat) => chat.id === selectedChatId) ?? null,
    [chats, selectedChatId],
  );

  const synchronize = useCallback(
    async (preserveChatId: string | null = null) => {
      const [chatResult, statusResult] = await Promise.allSettled([
        listChats(),
        getStatus(),
      ]);

      if (
        (chatResult.status === "rejected" &&
          handleUnauthorized(chatResult.reason)) ||
        (statusResult.status === "rejected" &&
          handleUnauthorized(statusResult.reason))
      ) {
        return;
      }

      if (chatResult.status === "fulfilled") {
        setChats((current) =>
          mergeSynchronizedChats(current, chatResult.value, preserveChatId),
        );
        setSelectedChatId((current) =>
          chatResult.value.some((chat) => chat.id === current)
            ? current
            : (chatResult.value[0]?.id ?? null),
        );
        setPhase("ready");
      }

      if (statusResult.status === "rejected") {
        setStatus(null);
        setStatusPhase("unavailable");
      } else {
        setStatus(statusResult.value);
        setStatusPhase("ready");
      }
    },
    [handleUnauthorized],
  );

  const createChat = useCallback(async () => {
    setPendingAction("create");
    setMessage(undefined);

    try {
      const model = defaultModel ?? models[0];
      const chat = await requestCreateChat(model ? { model } : {});
      setChats((current) => placeFirst(current, chat));
      setSelectedChatId(chat.id);
      setPhase("ready");
    } catch (error) {
      if (!handleUnauthorized(error)) {
        setMessage(
          actionErrorMessage(error, "A new conversation could not be created."),
        );
      }
    } finally {
      setPendingAction(null);
    }
  }, [defaultModel, handleUnauthorized, models]);

  const renameChat = useCallback(
    async (title: string) => {
      if (!selectedChat) {
        return false;
      }

      const trimmedTitle = title.trim();

      if (!trimmedTitle) {
        setMessage("Conversation titles cannot be empty.");
        return false;
      }

      if (trimmedTitle === selectedChat.title) {
        return true;
      }

      setPendingAction("rename");
      setMessage(undefined);

      try {
        const chat = await requestUpdateChat(selectedChat.id, {
          title: trimmedTitle,
        });
        setChats((current) => placeFirst(current, chat));
        return true;
      } catch (error) {
        if (!handleUnauthorized(error)) {
          setMessage(
            actionErrorMessage(error, "The conversation could not be renamed."),
          );
        }
        return false;
      } finally {
        setPendingAction(null);
      }
    },
    [handleUnauthorized, selectedChat],
  );

  const deleteChat = useCallback(async () => {
    if (!selectedChat) {
      return false;
    }

    setPendingAction("delete");
    setMessage(undefined);

    try {
      await requestDeleteChat(selectedChat.id);
      const remaining = chats.filter((chat) => chat.id !== selectedChat.id);
      setChats(remaining);
      setSelectedChatId(remaining[0]?.id ?? null);
      return true;
    } catch (error) {
      if (!handleUnauthorized(error)) {
        setMessage(
          actionErrorMessage(error, "The conversation could not be deleted."),
        );
      }
      return false;
    } finally {
      setPendingAction(null);
    }
  }, [chats, handleUnauthorized, selectedChat]);

  const changeModel = useCallback(
    async (model: string) => {
      if (!selectedChat || model === selectedChat.model) {
        return;
      }

      setPendingAction("model");
      setMessage(undefined);

      try {
        const chat = await requestUpdateChat(selectedChat.id, { model });
        setChats((current) => placeFirst(current, chat));
      } catch (error) {
        if (!handleUnauthorized(error)) {
          setMessage(
            actionErrorMessage(error, "The conversation model could not be changed."),
          );
        }
      } finally {
        setPendingAction(null);
      }
    },
    [handleUnauthorized, selectedChat],
  );

  const applyChatUpdate = useCallback((chat: ChatSummary) => {
    setChats((current) => placeFirst(current, chat));
  }, []);

  return {
    chats,
    selectedChat,
    phase,
    models,
    modelsPhase,
    status,
    statusPhase,
    message,
    pendingAction,
    selectChat: setSelectedChatId,
    refresh,
    synchronize,
    createChat,
    renameChat,
    deleteChat,
    changeModel,
    clearMessage: () => setMessage(undefined),
    applyChatUpdate,
  };
}
