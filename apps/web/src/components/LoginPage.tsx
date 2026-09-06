import { useState, type FormEvent } from "react";

import type { LoginCredentials } from "../api/client.js";
import { Brand } from "./Brand.js";

interface LoginPageProps {
  message?: string;
  pending: boolean;
  onSubmit: (credentials: LoginCredentials) => Promise<void>;
}

export function LoginPage({ message, pending, onSubmit }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onSubmit({ username, password });
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-heading">
        <div className="login-panel__intro">
          <Brand />
          <div className="login-panel__message">
            <p className="eyebrow">Private by design</p>
            <h1>Your conversations stay close to home.</h1>
            <p>
              A shared household workspace powered by the model running on
              this computer.
            </p>
          </div>
          <p className="login-panel__network">
            Available only on your household network
          </p>
        </div>

        <div className="login-panel__form">
          <div className="login-form__heading">
            <p className="eyebrow">Household access</p>
            <h2 id="login-heading">Welcome home</h2>
            <p>Sign in with the shared household account.</p>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
            <label className="field">
              <span>Username</span>
              <input
                name="username"
                type="text"
                autoComplete="username"
                maxLength={128}
                required
                autoFocus
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>

            <label className="field">
              <span>Password</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                maxLength={1024}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>

            {message ? (
              <p className="form-message" role="alert">
                {message}
              </p>
            ) : null}

            <button
              className="button button--primary button--wide"
              type="submit"
              disabled={pending}
            >
              {pending ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="login-form__footnote">
            Conversations are shared with everyone using this account.
          </p>
        </div>
      </section>
    </main>
  );
}
