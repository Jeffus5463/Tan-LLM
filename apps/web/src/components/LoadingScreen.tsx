import { Brand } from "./Brand.js";

export function LoadingScreen() {
  return (
    <main className="status-screen" aria-busy="true">
      <Brand />
      <div className="loading-indicator" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p>Connecting to your local workspace</p>
    </main>
  );
}
