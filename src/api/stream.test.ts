import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StreamStore } from "./stream";

describe("StreamStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts the stream on the first subscriber and publishes updates", () => {
    const store = new StreamStore<number[]>(
      () => [],
      async ({ update }) => {
        update(() => [1]);
        await new Promise(() => {});
      },
    );
    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });

    expect(store.getSnapshot().phase).toBe("active");
    expect(store.getSnapshot().data).toEqual([1]);
    expect(notified).toBeGreaterThan(0);
    unsubscribe();
  });

  it("aborts the stream when the last subscriber leaves", () => {
    let aborted = false;
    const store = new StreamStore<null>(
      () => null,
      ({ signal }) => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        return new Promise(() => {});
      },
    );
    const unsubscribe = store.subscribe(() => {});
    expect(aborted).toBe(false);
    unsubscribe();
    expect(aborted).toBe(true);
  });

  it("reconnects with backoff after a retryable error", async () => {
    let calls = 0;
    const store = new StreamStore<null>(
      () => null,
      async () => {
        calls += 1;
        throw new Error("boom");
      },
    );
    const unsubscribe = store.subscribe(() => {});

    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    expect(store.getSnapshot().phase).toBe("error");
    expect(store.getSnapshot().error).toBe("boom");

    // First retry comes after 1 s, the second one 2 s later.
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(3);
    unsubscribe();
  });

  it("stops permanently on errors a retry cannot fix", async () => {
    let calls = 0;
    const store = new StreamStore<null>(
      () => null,
      async () => {
        calls += 1;
        throw new ConnectError("bad secret", Code.Unauthenticated);
      },
    );
    const unsubscribe = store.subscribe(() => {});

    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().phase).toBe("error");
    expect(store.getSnapshot().errorCode).toBe(Code.Unauthenticated);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(1);
    unsubscribe();
  });

  it("restarts a fatally stopped stream when a subscriber returns", async () => {
    let calls = 0;
    const store = new StreamStore<null>(
      () => null,
      async () => {
        calls += 1;
        throw new ConnectError("bad secret", Code.Unauthenticated);
      },
    );
    const first = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    first();

    const second = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
    second();
  });

  it("resets data on reconnect when configured to", async () => {
    let calls = 0;
    const store = new StreamStore<number[]>(
      () => [],
      async ({ update }) => {
        calls += 1;
        update((data) => data.concat(calls));
        throw new Error("boom");
      },
      true,
    );
    const unsubscribe = store.subscribe(() => {});

    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(2);
    // Without resetOnReconnect this would be [1, 2].
    expect(store.getSnapshot().data).toEqual([2]);
    unsubscribe();
  });
});
