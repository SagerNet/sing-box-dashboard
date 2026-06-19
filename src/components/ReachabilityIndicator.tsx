import { useEffect, useRef, useState } from "react";

import { normalizeServerUrl, type Server } from "../api/config";
import { DaemonApi } from "../api/daemon";
import { useDiagnosedConnectError } from "../app/connectError";
import { useI18n } from "../app/i18n";
import { Spinner, StateDot } from "./ui";
import styles from "./ReachabilityIndicator.module.css";
import { cx } from "../lib/cx";

export type ReachabilityStatus = "idle" | "checking" | "online" | "offline";

export interface Reachability {
  status: ReachabilityStatus;
  error: string | null;
}

const DEBOUNCE_MS = 300;
const PROBE_TIMEOUT_MS = 8000;

async function probeReachable(server: Server, signal: AbortSignal): Promise<void> {
  const api = new DaemonApi(server);
  for await (const _ of api.client.subscribeServiceStatus({}, { signal })) {
    void _;
    return;
  }
  throw new Error("Stream ended without a status message");
}

export async function checkServerReachable(
  url: string,
  secret: string,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    await probeReachable({ id: "", name: "", url: normalizeServerUrl(url), secret }, signal);
    return true;
  } catch {
    return false;
  }
}

export function useServerReachability(url: string, secret: string): Reachability {
  const { t } = useI18n();
  const normalized = normalizeServerUrl(url);
  const [state, setState] = useState<Reachability>({ status: "idle", error: null });
  const firstRun = useRef(true);

  useEffect(() => {
    const immediate = firstRun.current;
    firstRun.current = false;
    if (normalized === "") {
      setState({ status: "idle", error: null });
      return;
    }
    let cancelled = false;
    setState({ status: "checking", error: null });
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const debounce = setTimeout(() => {
      timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      probeReachable({ id: "", name: "", url: normalized, secret }, controller.signal)
        .then(() => {
          if (!cancelled) {
            setState({ status: "online", error: null });
          }
        })
        .catch((probeError: unknown) => {
          if (cancelled) {
            return;
          }
          const message = controller.signal.aborted
            ? t("Connection timed out after {seconds} seconds", {
                seconds: PROBE_TIMEOUT_MS / 1000,
              })
            : probeError instanceof Error
              ? probeError.message
              : String(probeError);
          setState({ status: "offline", error: message });
        })
        .finally(() => clearTimeout(timeout));
    }, immediate ? 0 : DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(debounce);
      clearTimeout(timeout);
      controller.abort();
    };
  }, [normalized, secret, t]);

  return state;
}

export function ReachabilityIndicator(props: { reachability: Reachability; url: string }) {
  const { t } = useI18n();
  const { status, error } = props.reachability;
  const detail = useDiagnosedConnectError(error, normalizeServerUrl(props.url));
  if (status === "idle") {
    return null;
  }
  return (
    <div className={cx(styles.reachability, styles[status])}>
      {status === "checking" ? (
        <Spinner className={styles.spinner} />
      ) : (
        <StateDot tone={status === "online" ? "good" : "bad"} className={styles.dot} />
      )}
      <span>
        {status === "checking"
          ? t("Checking...")
          : status === "online"
            ? t("Available")
            : (detail ?? t("Unavailable"))}
      </span>
    </div>
  );
}
