import { useSession } from "./auth/useSession.js";
import { ChatShell } from "./components/ChatShell.js";
import { LoadingScreen } from "./components/LoadingScreen.js";
import { LoginPage } from "./components/LoginPage.js";
import { ServiceUnavailable } from "./components/ServiceUnavailable.js";

export function App() {
  const {
    session,
    loginPending,
    logoutPending,
    shellMessage,
    checkSession,
    signIn,
    signOut,
    expireSession,
  } = useSession();

  if (session.phase === "checking") {
    return <LoadingScreen />;
  }

  if (session.phase === "unavailable") {
    return <ServiceUnavailable onRetry={() => void checkSession()} />;
  }

  if (session.phase === "anonymous") {
    return (
      <LoginPage
        message={session.message}
        pending={loginPending}
        onSubmit={signIn}
      />
    );
  }

  return (
    <ChatShell
      username={session.username}
      logoutPending={logoutPending}
      message={shellMessage}
      onLogout={signOut}
      onSessionExpired={expireSession}
    />
  );
}
