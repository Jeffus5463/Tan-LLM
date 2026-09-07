import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useVisiblePolling } from "./useVisiblePolling.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("visible-page polling", () => {
  it("polls every five seconds only while the page is visible", async () => {
    vi.useFakeTimers();
    let visibilityState: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibilityState,
    );
    const synchronize = vi.fn(async () => undefined);

    renderHook(() => useVisiblePolling(synchronize));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(synchronize).toHaveBeenCalledOnce();

    visibilityState = "hidden";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(synchronize).toHaveBeenCalledOnce();

    visibilityState = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(synchronize).toHaveBeenCalledTimes(2);
  });

  it("does not overlap slow synchronization requests", async () => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    let finishRequest: (() => void) | undefined;
    const synchronize = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRequest = resolve;
        }),
    );

    renderHook(() => useVisiblePolling(synchronize));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(synchronize).toHaveBeenCalledOnce();

    await act(async () => {
      finishRequest?.();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(synchronize).toHaveBeenCalledTimes(2);
  });
});
