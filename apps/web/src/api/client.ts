export interface Session {
  username: string;
}

export interface LoginCredentials {
  username: string;
  password: string;
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
