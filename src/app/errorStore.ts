import { useSyncExternalStore } from "react";

import { describeError } from "../api/stream";

// Failure queue for fire-and-forget mutations (close connection, clear logs,
// log out, ...) whose rejections would otherwise be invisible. A module-level
// store in the StreamStore style so call sites can `.catch(showError)`
// without threading a context through; App presents the queue head in a
// dialog (GlobalErrorDialog) one error at a time.

let queue: string[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function showError(error: unknown) {
  queue = [...queue, describeError(error).message];
  emit();
}

export function dismissError() {
  queue = queue.slice(1);
  emit();
}

export function useCurrentError(): string | null {
  return useSyncExternalStore(subscribe, () => queue[0] ?? null);
}
