export interface Session {
  username: string;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface ChatSummary {
  id: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  sequence: number;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "complete" | "cancelled" | "interrupted" | "error";
  createdAt: string;
  updatedAt: string;
}

export interface ChatDetail extends ChatSummary {
  messages: ChatMessage[];
}

export interface ModelsResponse {
  defaultModel: string | null;
  models: string[];
}

export interface ActiveGeneration {
  chatId: string;
  messageId: string;
}

export interface ApplicationStatus {
  services: {
    ollama: "available" | "offline";
  };
  activeGeneration: ActiveGeneration | null;
}

interface ChatListResponse {
  chats: ChatSummary[];
}

interface ChatResponse {
  chat: ChatSummary;
}

interface ChatDetailResponse {
  chat: ChatDetail;
}

export interface CreateChatInput {
  title?: string;
  model?: string;
}

export interface UpdateChatInput {
  title?: string;
  model?: string;
}

interface ErrorPayload {
  error?: unknown;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(
    status: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ApiError";
    this.status = status;
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ApiError(response.status, "The server returned invalid data.", {
      cause: error,
    });
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");

  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;

  try {
    response = await fetch(path, {
      ...options,
      headers,
      credentials: "same-origin",
    });
  } catch (error) {
    throw new ApiError(0, "The local service could not be reached.", {
      cause: error,
    });
  }

  const payload = await parseResponse(response);

  if (!response.ok) {
    const errorPayload = payload as ErrorPayload | undefined;
    const message =
      typeof errorPayload?.error === "string"
        ? errorPayload.error
        : `Request failed with status ${response.status}.`;

    throw new ApiError(response.status, message);
  }

  return payload as T;
}

export function getSession(): Promise<Session> {
  return request<Session>("/api/auth/session");
}

export function login(credentials: LoginCredentials): Promise<Session> {
  return request<Session>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
}

export function logout(): Promise<void> {
  return request<void>("/api/auth/logout", {
    method: "POST",
  });
}

export async function listChats(): Promise<ChatSummary[]> {
  const response = await request<ChatListResponse>("/api/chats");

  return response.chats;
}

export async function createChat(
  input: CreateChatInput = {},
): Promise<ChatSummary> {
  const response = await request<ChatResponse>("/api/chats", {
    method: "POST",
    body: JSON.stringify(input),
  });

  return response.chat;
}

export async function getChat(chatId: string): Promise<ChatDetail> {
  const response = await request<ChatDetailResponse>(
    `/api/chats/${encodeURIComponent(chatId)}`,
  );

  return response.chat;
}

export async function updateChat(
  chatId: string,
  input: UpdateChatInput,
): Promise<ChatSummary> {
  const response = await request<ChatResponse>(
    `/api/chats/${encodeURIComponent(chatId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );

  return response.chat;
}

export function deleteChat(chatId: string): Promise<void> {
  return request<void>(`/api/chats/${encodeURIComponent(chatId)}`, {
    method: "DELETE",
  });
}

export function listModels(): Promise<ModelsResponse> {
  return request<ModelsResponse>("/api/models");
}

export function getStatus(): Promise<ApplicationStatus> {
  return request<ApplicationStatus>("/api/status");
}
