import { useEffect, useRef } from "react";

const DEFAULT_INTERVAL_MS = 5_000;

export function useVisiblePolling(
  synchronize: () => Promise<void>,
  intervalMs = DEFAULT_INTERVAL_MS,
): void {
  const synchronizeRef = useRef(synchronize);
  synchronizeRef.current = synchronize;

  useEffect(() => {
    let requestInFlight = false;

    const poll = async () => {
      if (document.visibilityState !== "visible" || requestInFlight) {
        return;
      }

      requestInFlight = true;

      try {
        await synchronizeRef.current();
      } finally {
        requestInFlight = false;
      }
    };

    const interval = window.setInterval(() => {
      void poll();
    }, intervalMs);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void poll();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [intervalMs]);
}
