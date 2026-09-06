import { useCallback, useEffect, useState } from "react";

import {
  ApiError,
  getSession,
  login as requestLogin,
  logout as requestLogout,
  type LoginCredentials,
} from "../api/client.js";

type SessionState =
  | { phase: "checking" }
  | { phase: "anonymous"; message?: string }
  | { phase: "unavailable" }
  | { phase: "authenticated"; username: string };

function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "The username or password is incorrect.";
    }

    if (error.status === 429) {
      return "Too many sign-in attempts. Try again in 15 minutes.";
    }
  }

  return "Sign in failed. Check that the local service is running.";
}

export function useSession() {
  const [session, setSession] = useState<SessionState>({
    phase: "checking",
  });
  const [loginPending, setLoginPending] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [shellMessage, setShellMessage] = useState<string>();

  const checkSession = useCallback(async () => {
    setSession({ phase: "checking" });

    try {
      const currentSession = await getSession();
      setSession({
        phase: "authenticated",
        username: currentSession.username,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setSession({ phase: "anonymous" });
      } else {
        setSession({ phase: "unavailable" });
      }
    }
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  const signIn = useCallback(async (credentials: LoginCredentials) => {
    setLoginPending(true);
    setSession({ phase: "anonymous" });

    try {
      const authenticatedSession = await requestLogin(credentials);
      setSession({
        phase: "authenticated",
        username: authenticatedSession.username,
      });
      setShellMessage(undefined);
    } catch (error) {
      setSession({
        phase: "anonymous",
        message: loginErrorMessage(error),
      });
    } finally {
      setLoginPending(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    setLogoutPending(true);
    setShellMessage(undefined);

    try {
      await requestLogout();
      setSession({ phase: "anonymous" });
    } catch {
      setShellMessage(
        "Sign out failed because the local service could not be reached.",
      );
    } finally {
      setLogoutPending(false);
    }
  }, []);

  return {
    session,
    loginPending,
    logoutPending,
    shellMessage,
    checkSession,
    signIn,
    signOut,
  };
}
