import { Brand } from "./Brand.js";

interface ServiceUnavailableProps {
  onRetry: () => void;
}

export function ServiceUnavailable({ onRetry }: ServiceUnavailableProps) {
  return (
    <main className="status-screen">
      <Brand />
      <div className="status-screen__symbol" aria-hidden="true">
        !
      </div>
      <h1>Local service unavailable</h1>
      <p>
        Tan LLM could not reach the application service. Check that it is
        running, then try again.
      </p>
      <button className="button button--primary" type="button" onClick={onRetry}>
        Try again
      </button>
    </main>
  );
}
