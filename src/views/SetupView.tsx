import { useEffect, useRef, useState } from "react";

import { createServerId, normalizeServerUrl, type Server } from "../api/config";
import { DaemonApi } from "../api/daemon";
import { useDiagnosedConnectError } from "../app/connectError";
import type { AccentPreference, ThemePreference } from "../app/context";
import { LanguageSelect, useI18n, type Translate } from "../app/i18n";
import { Icon } from "../components/Icon";
import {
  checkServerReachable,
  ReachabilityIndicator,
  useServerReachability,
} from "../components/ReachabilityIndicator";
import { Brand, Button, Field, Spinner, ThemeMenu, ThemeSelect } from "../components/ui";
import { guessApiBaseUrl } from "../lib/connectivity";
import styles from "./SetupView.module.css";

const CONNECT_TIMEOUT_MS = 8000;
const AUTODETECT_TIMEOUT_MS = 8000;

async function testConnection(server: Server, signal: AbortSignal, t: Translate): Promise<void> {
  const api = new DaemonApi(server);
  for await (const _ of api.client.subscribeServiceStatus({}, { signal })) {
    void _;
    return;
  }
  throw new Error(t("Stream ended without a status message"));
}

export function SetupView(props: {
  onCreate: (server: Server) => void;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  accent: AccentPreference;
  onAccentChange: (accent: AccentPreference) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<{ message: string; url: string } | null>(null);
  const errorDetail = useDiagnosedConnectError(error?.message ?? null, error?.url ?? "");
  const reachability = useServerReachability(url, secret);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  useEffect(() => {
    const candidate = guessApiBaseUrl(location.href);
    if (candidate === null) {
      return;
    }
    const normalized = normalizeServerUrl(candidate);
    if (normalized === "") {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AUTODETECT_TIMEOUT_MS);
    void checkServerReachable(normalized, "", controller.signal)
      .then((reachable) => {
        if (reachable) {
          setUrl((current) => (current === "" ? normalized : current));
        }
      })
      .finally(() => clearTimeout(timer));
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);

  const normalizedUrl = normalizeServerUrl(url);
  const valid = normalizedUrl !== "";

  const submit = async () => {
    if (!valid || connecting) {
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setConnecting(true);
    setError(null);
    try {
      const server: Server = {
        id: createServerId(),
        name: name.trim(),
        url: normalizedUrl,
        secret,
      };
      await Promise.race([
        testConnection(server, controller.signal, t),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(
              new Error(
                t("Connection timed out after {seconds} seconds", {
                  seconds: CONNECT_TIMEOUT_MS / 1000,
                }),
              ),
            );
          }, CONNECT_TIMEOUT_MS);
        }),
      ]);
      props.onCreate(server);
    } catch (connectError) {
      setError({
        message: connectError instanceof Error ? connectError.message : String(connectError),
        url: normalizedUrl,
      });
    } finally {
      clearTimeout(timer);
      setConnecting(false);
    }
  };

  return (
    <div className="setup">
      <div className="setup-panel">
        <Brand />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field label={t("Name")}>
            <input
              className="input"
              value={name}
              placeholder={t("Optional")}
              disabled={connecting}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label={t("URL")}>
            <input
              className="input"
              value={url}
              placeholder={t("Required")}
              autoFocus
              disabled={connecting}
              onChange={(event) => setUrl(event.target.value)}
            />
          </Field>
          <Field label={t("Secret")}>
            <input
              className="input"
              value={secret}
              placeholder={t("Optional")}
              autoComplete="off"
              disabled={connecting}
              onChange={(event) => setSecret(event.target.value)}
            />
          </Field>
          {error === null && <ReachabilityIndicator reachability={reachability} url={url} />}
          {errorDetail !== null && (
            <div className="banner error">
              <Icon name="warning_amber" />
              <div>{errorDetail}</div>
            </div>
          )}
          <Button
            variant="primary"
            className={styles.setupSubmit}
            type="submit"
            disabled={!valid || connecting || reachability.status !== "online"}
          >
            {connecting && <Spinner />}
            {connecting ? t("Connecting...") : t("Connect")}
          </Button>
        </form>
        <div className={styles.setupFooter}>
          <div className="settings-row">
            <span className="settings-row-label">{t("Appearance")}</span>
            <ThemeSelect theme={props.theme} onChange={props.onThemeChange} />
          </div>
          <div className="settings-row">
            <span className="settings-row-label">{t("Theme")}</span>
            <ThemeMenu accent={props.accent} onChange={props.onAccentChange} openUp />
          </div>
          <div className="settings-row">
            <span className="settings-row-label">{t("Language")}</span>
            <LanguageSelect />
          </div>
        </div>
      </div>
    </div>
  );
}
