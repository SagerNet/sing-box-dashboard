import { Code, ConnectError } from "@connectrpc/connect";
import { useSyncExternalStore } from "react";

export type StreamPhase = "connecting" | "active" | "error";

export interface StreamSnapshot<T> {
  phase: StreamPhase;
  error?: string;
  errorCode?: Code;
  data: T;
}

export interface StreamContext<T> {
  signal: AbortSignal;
  update(updater: (data: T) => T): void;
}

export function describeError(error: unknown): { message: string; code?: Code } {
  if (error instanceof ConnectError) {
    return { message: error.rawMessage, code: error.code };
  }
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: String(error) };
}

function sleep(durationMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, durationMs);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// A subscription stream shared by all components observing it: the stream is
// opened while at least one component subscribes, and reconnects with backoff
// until the error is one a retry cannot fix.
export class StreamStore<T> {
  private listeners = new Set<() => void>();
  private snapshot: StreamSnapshot<T>;
  private controller: AbortController | null = null;

  constructor(
    private createInitial: () => T,
    private runStream: (context: StreamContext<T>) => Promise<void>,
    private resetOnReconnect = false,
  ) {
    this.snapshot = { phase: "connecting", data: createInitial() };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      this.start();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stop();
      }
    };
  };

  getSnapshot = (): StreamSnapshot<T> => this.snapshot;

  private setSnapshot(next: StreamSnapshot<T>) {
    this.snapshot = next;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private start() {
    const controller = new AbortController();
    this.controller = controller;
    void this.loop(controller.signal);
  }

  private stop() {
    this.controller?.abort();
    this.controller = null;
  }

  private async loop(signal: AbortSignal) {
    let attempt = 0;
    while (!signal.aborted) {
      const data = this.resetOnReconnect ? this.createInitial() : this.snapshot.data;
      this.setSnapshot({ phase: "connecting", data });
      try {
        await this.runStream({
          signal,
          update: (updater) => {
            attempt = 0;
            this.setSnapshot({ phase: "active", data: updater(this.snapshot.data) });
          },
        });
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        const described = describeError(error);
        this.setSnapshot({
          ...this.snapshot,
          phase: "error",
          error: described.message,
          errorCode: described.code,
        });
        if (
          described.code === Code.Unimplemented ||
          described.code === Code.Unauthenticated ||
          described.code === Code.PermissionDenied
        ) {
          return;
        }
      }
      attempt += 1;
      await sleep(Math.min(1000 * attempt, 5000), signal);
    }
  }
}

export function useStream<T>(store: StreamStore<T>): StreamSnapshot<T> {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
