import { useEffect, useRef, useState, type RefObject } from "react";

// Overlays and menus register here while open; Escape dismisses only the
// topmost one, so e.g. a menu open inside a dialog closes before the dialog.
const escapeStack: (() => void)[] = [];

function useEscapeEntry(active: boolean, onDismiss: () => void) {
  // Read through a ref so a new callback identity per render neither
  // re-registers the listener nor needs to be a dependency.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (!active) {
      return;
    }
    const entry = () => dismissRef.current();
    escapeStack.push(entry);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && escapeStack[escapeStack.length - 1] === entry) {
        event.preventDefault();
        entry();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      const index = escapeStack.indexOf(entry);
      if (index >= 0) {
        escapeStack.splice(index, 1);
      }
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [active]);
}

// Dismissal behavior shared by the popup menus (server picker, theme menu,
// overflow menus): pointerdown outside the anchor or Escape closes them.
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onDismiss: () => void,
) {
  useEscapeEntry(open, onDismiss);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        dismissRef.current();
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [ref, open]);
}

// For overlays that are mounted only while open (Dialog, Drawer).
export function useEscapeToClose(onClose: () => void) {
  useEscapeEntry(true, onClose);
}

// State machine shared by the streaming tools (network quality test, STUN
// test, Tailscale ping): a running flag plus a stream error, with the stream
// aborted on unmount and the rejection a user-initiated stop causes ignored.
export function useStreamingAction(): {
  running: boolean;
  error: string;
  reportError: (message: string) => void;
  start: (run: (signal: AbortSignal) => Promise<void>) => void;
  stop: () => void;
} {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const start = (run: (signal: AbortSignal) => Promise<void>) => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setError("");
    void run(controller.signal)
      .catch((streamError: unknown) => {
        if (!controller.signal.aborted) {
          setError(String(streamError));
        }
      })
      .finally(() => setRunning(false));
  };

  const stop = () => {
    controllerRef.current?.abort();
    setRunning(false);
  };

  return { running, error, reportError: setError, start, stop };
}
