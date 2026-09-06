import { Brand } from "./Brand.js";

interface ChatShellProps {
  username: string;
  logoutPending: boolean;
  message?: string;
  onLogout: () => Promise<void>;
}

export function ChatShell({
  username,
  logoutPending,
  message,
  onLogout,
}: ChatShellProps) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__header">
          <Brand compact />
          <p>Household workspace</p>
        </div>

        <nav className="conversation-list" aria-label="Shared conversations">
          <div className="conversation-list__heading">
            <span>Conversations</span>
            <span className="conversation-count">0</span>
          </div>
          <div className="conversation-list__empty">
            <span aria-hidden="true">•••</span>
            <p>Your shared conversations will appear here.</p>
          </div>
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
        <header className="workspace__header">
          <Brand compact />
          <span className="workspace__scope">Shared household history</span>
        </header>

        {message ? (
          <p className="shell-message" role="alert">
            {message}
          </p>
        ) : null}

        <section className="workspace__welcome" aria-labelledby="welcome-heading">
          <div className="welcome-mark" aria-hidden="true">
            T
          </div>
          <p className="eyebrow">Local conversations</p>
          <h1 id="welcome-heading">Your household workspace</h1>
          <p>
            Private model access and shared conversation history, hosted on
            your own network.
          </p>
          <div className="privacy-note">
            <span className="privacy-note__dot" aria-hidden="true" />
            Messages stay within this local setup
          </div>
        </section>
      </main>
    </div>
  );
}
