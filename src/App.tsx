import { useEffect, useMemo, useRef, useState } from "react";

import {
  loadServersState,
  saveServersState,
  serverDisplayName,
  type Server,
  type ServersState,
} from "./api/config";
import { DaemonApi } from "./api/daemon";
import { formatDateTime, formatUptime, isHttpUrl } from "./api/format";
import { isTerminalCode, useStream } from "./api/stream";
import { ServiceStatus_Type, type DeprecatedWarning } from "./gen/daemon/started_service_pb";
import { CapabilitiesContext, makeCapabilities } from "./app/capabilities";
import {
  ApiContext,
  applyAccent,
  applyTheme,
  loadAccentPreference,
  loadThemePreference,
  navigate,
  saveAccentPreference,
  saveThemePreference,
  useApi,
  useNow,
  watchSystemTheme,
  type AccentPreference,
  type ThemePreference,
} from "./app/context";
import { dismissError, useCurrentError } from "./app/errorStore";
import { useDismiss, useStreamOutage, useUnaryOnce } from "./app/hooks";
import { I18nProvider, useI18n } from "./app/i18n";
import { Icon, type IconName } from "./components/Icon";
import { Dialog, Spinner } from "./components/ui";
import { SSH_DEFAULT_TERMINAL_TYPE, SSH_DEFAULT_USERNAME } from "./lib/tailscaleSSH";
import { ConnectionErrorView } from "./views/ConnectionErrorView";
import { ConnectionsView } from "./views/ConnectionsView";
import { GroupsView } from "./views/GroupsView";
import { LogsView } from "./views/LogsView";
import { OverviewView } from "./views/OverviewView";
import {
  PreferencesView,
  ServersView,
  SettingsView,
  TerminalConfigurationView,
  TerminalThemeEditorView,
  TerminalThemePickerView,
} from "./views/SettingsView";
import { SetupView } from "./views/SetupView";
import { NetworkQualityView, STUNTestView, ToolsView } from "./views/ToolsView";
import { TailscaleEndpointView } from "./views/TailscaleView";
import { TailscaleSSHView } from "./views/TerminalView";
import { UsbipView } from "./views/UsbipView";

export type Route =
  | { page: "overview" }
  | { page: "groups" }
  | { page: "connections" }
  | { page: "logs" }
  | { page: "tools" }
  | { page: "tools/network-quality" }
  | { page: "tools/stun" }
  | { page: "tools/tailscale"; tag: string }
  | { page: "tools/tailscale/ssh"; tag: string; peerID: string; username: string; terminalType: string }
  | { page: "tools/usbip"; tag: string }
  | { page: "settings" }
  | { page: "settings/preferences" }
  | { page: "settings/preferences/terminal" }
  | { page: "settings/preferences/terminal/theme"; scheme: "light" | "dark" }
  | { page: "settings/preferences/terminal/custom"; scheme: "light" | "dark" }
  | { page: "settings/servers" };

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function routeFromHash(): Route {
  const hash = location.hash.replace(/^#\/?/, "");
  const queryIndex = hash.indexOf("?");
  const query = new URLSearchParams(queryIndex >= 0 ? hash.slice(queryIndex + 1) : "");
  const segments = (queryIndex >= 0 ? hash.slice(0, queryIndex) : hash)
    .split("/")
    .map(decodeSegment);
  switch (segments[0]) {
    case "groups":
      return { page: "groups" };
    case "connections":
      return { page: "connections" };
    case "logs":
      return { page: "logs" };
    case "tools":
      switch (segments[1]) {
        case "network-quality":
          return { page: "tools/network-quality" };
        case "stun":
          return { page: "tools/stun" };
        case "tailscale":
          if (segments[3] === "ssh" && segments[4]) {
            return {
              page: "tools/tailscale/ssh",
              tag: segments[2] ?? "",
              peerID: segments[4],
              username: query.get("username") || SSH_DEFAULT_USERNAME,
              terminalType: query.get("terminalType") || SSH_DEFAULT_TERMINAL_TYPE,
            };
          }
          return { page: "tools/tailscale", tag: segments[2] ?? "" };
        case "usbip":
          return { page: "tools/usbip", tag: segments[2] ?? "" };
        default:
          return { page: "tools" };
      }
    case "settings":
      switch (segments[1]) {
        case "preferences":
          if (segments[2] === "terminal") {
            if (segments[3] === "theme" && (segments[4] === "light" || segments[4] === "dark")) {
              return { page: "settings/preferences/terminal/theme", scheme: segments[4] };
            }
            if (segments[3] === "custom" && (segments[4] === "light" || segments[4] === "dark")) {
              return { page: "settings/preferences/terminal/custom", scheme: segments[4] };
            }
            return { page: "settings/preferences/terminal" };
          }
          return { page: "settings/preferences" };
        case "servers":
          return { page: "settings/servers" };
        default:
          return { page: "settings" };
      }
    default:
      return { page: "overview" };
  }
}

// Tools subpages that require the service to be started (tailscale, usbip).
// Unlike network-quality/stun, they fall back to the tools list rather than
// overview when the service stops.
function isStartedOnlyToolsSubpage(page: string): boolean {
  return page.startsWith("tools/tailscale") || page.startsWith("tools/usbip");
}

export function App() {
  const [serversState, setServersState] = useState<ServersState>(() => loadServersState());
  const [theme, setTheme] = useState<ThemePreference>(() => loadThemePreference());
  const [accent, setAccent] = useState<AccentPreference>(() => loadAccentPreference());
  const [route, setRoute] = useState<Route>(() => routeFromHash());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  useEffect(() => watchSystemTheme(() => loadThemePreference()), []);

  useEffect(() => {
    const onHashChange = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const activeServer =
    serversState.servers.find((server) => server.id === serversState.activeId) ?? null;

  useEffect(() => {
    if (!activeServer && location.hash !== "") {
      history.replaceState(null, "", location.pathname + location.search);
      setRoute(routeFromHash());
    }
  }, [activeServer]);

  const updateServers = (next: ServersState) => {
    saveServersState(next);
    setServersState(next);
  };

  const updateTheme = (next: ThemePreference) => {
    saveThemePreference(next);
    setTheme(next);
  };

  const updateAccent = (next: AccentPreference) => {
    saveAccentPreference(next);
    setAccent(next);
  };

  return (
    <I18nProvider>
      {!activeServer ? (
        <SetupView
          onCreate={(server) => {
            updateServers({ servers: [...serversState.servers, server], activeId: server.id });
            navigate("overview");
          }}
          theme={theme}
          onThemeChange={updateTheme}
          accent={accent}
          onAccentChange={updateAccent}
        />
      ) : (
        <Shell
          key={activeServer.id}
          server={activeServer}
          serversState={serversState}
          onServersChange={updateServers}
          route={route}
          theme={theme}
          onThemeChange={updateTheme}
          accent={accent}
          onAccentChange={updateAccent}
        />
      )}
      <GlobalErrorDialog />
    </I18nProvider>
  );
}

function GlobalErrorDialog() {
  const { t } = useI18n();
  const message = useCurrentError();
  if (message === null) {
    return null;
  }
  return (
    <Dialog onClose={dismissError}>
      <h3>{t("Error")}</h3>
      <p className="dialog-message">{message}</p>
      <div className="row-actions dialog-actions">
        <button
          className="button"
          onClick={() => {
            void navigator.clipboard.writeText(message).catch(() => {});
          }}
        >
          {t("Copy")}
        </button>
        <button className="button primary" onClick={dismissError}>
          {t("Ok")}
        </button>
      </div>
    </Dialog>
  );
}

function Shell(props: {
  server: Server;
  serversState: ServersState;
  onServersChange: (state: ServersState) => void;
  route: Route;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  accent: AccentPreference;
  onAccentChange: (accent: AccentPreference) => void;
}) {
  const [generation, setGeneration] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const api = useMemo(() => new DaemonApi(props.server), [props.server, generation]);
  return (
    <ApiContext.Provider value={api}>
      <ShellContent {...props} onRetry={() => setGeneration(generation + 1)} />
    </ApiContext.Provider>
  );
}

function ShellContent(props: {
  server: Server;
  serversState: ServersState;
  onServersChange: (state: ServersState) => void;
  route: Route;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  accent: AccentPreference;
  onAccentChange: (accent: AccentPreference) => void;
  onRetry: () => void;
}) {
  const api = useApi();
  const { t } = useI18n();
  const route = props.route;
  const serviceStatus = useStream(api.serviceStatus);
  const groups = useStream(api.groups);
  const [menuOpen, setMenuOpen] = useState(false);

  const lostError = useStreamOutage(
    serviceStatus,
    isTerminalCode(serviceStatus.errorCode) || serviceStatus.data.status === null,
  );

  useEffect(() => {
    const kick = () => {
      if (!document.hidden) {
        api.retryNow();
      }
    };
    document.addEventListener("visibilitychange", kick);
    window.addEventListener("pageshow", kick);
    window.addEventListener("online", kick);
    return () => {
      document.removeEventListener("visibilitychange", kick);
      window.removeEventListener("pageshow", kick);
      window.removeEventListener("online", kick);
    };
  }, [api]);

  const reachable = serviceStatus.phase === "active";
  const serverInfo = useUnaryOnce(() => api.serverInfo(), reachable);
  const capabilities = useMemo(
    () => makeCapabilities(serverInfo?.apiVersion ?? null),
    [serverInfo],
  );

  useEffect(() => {
    setMenuOpen(false);
  }, [route]);

  const started = serviceStatus.data.status?.status === ServiceStatus_Type.STARTED;
  const hasGroups = started && groups.data.loaded && groups.data.groups.length > 0;
  const known = serviceStatus.phase !== "connecting" || serviceStatus.data.status !== null;

  const groupsKnown = groups.data.loaded || groups.phase === "error";
  useEffect(() => {
    if (!known) {
      return;
    }
    const invisible =
      (route.page === "groups" && (!started || (groupsKnown && !hasGroups))) ||
      (route.page === "connections" && !started) ||
      (isStartedOnlyToolsSubpage(route.page) && !started) ||
      (route.page === "tools/usbip" && capabilities.ready && !capabilities.supports("usbip"));
    if (invisible) {
      navigate(isStartedOnlyToolsSubpage(route.page) ? "tools" : "overview");
    }
  }, [known, started, groupsKnown, hasGroups, route, capabilities]);

  if (lostError !== null) {
    return (
      <ConnectionErrorView
        server={props.server}
        error={lostError}
        reconnecting={serviceStatus.phase === "connecting"}
        onRetry={props.onRetry}
        serversState={props.serversState}
        onServersChange={props.onServersChange}
      />
    );
  }

  if (serviceStatus.data.status === null) {
    return (
      <div className="connecting-view">
        <div className="setup-brand">
          sing-box
          <small>dashboard</small>
        </div>
        <Spinner />
      </div>
    );
  }

  if (route.page === "tools/tailscale/ssh") {
    return (
      <TailscaleSSHView
        key={`${route.tag}/${route.peerID}/${route.username}/${route.terminalType}`}
        tag={route.tag}
        peerID={route.peerID}
        username={route.username}
        terminalType={route.terminalType}
      />
    );
  }

  const navItem = (page: string, title: string, icon: IconName, active: boolean) => (
    <button
      key={page}
      className={active ? "nav-item active" : "nav-item"}
      onClick={() => {
        setMenuOpen(false);
        navigate(page);
      }}
    >
      <Icon name={icon} />
      {title}
    </button>
  );

  return (
    <CapabilitiesContext.Provider value={capabilities}>
      <div className="app">
        <header className="mobile-topbar">
          <button
            className="icon-button"
            aria-label={t("Toggle navigation")}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Icon name={menuOpen ? "close" : "menu"} size={18} />
          </button>
          <div className="mobile-topbar-brand">sing-box</div>
        </header>
        {menuOpen && <div className="sidebar-scrim" onClick={() => setMenuOpen(false)} />}
        <nav className={menuOpen ? "sidebar open" : "sidebar"}>
          <div className="sidebar-brand">
            sing-box
            {serverInfo && <span className="sidebar-brand-version">{serverInfo.version}</span>}
          </div>
          {navItem("overview", t("Overview"), "dashboard", route.page === "overview")}
          {hasGroups && navItem("groups", t("Groups"), "folder", route.page === "groups")}
          {started && navItem("connections", t("Connections"), "swap_vert", route.page === "connections")}
          {navItem("logs", t("Logs"), "text_snippet", route.page === "logs")}
          {navItem("tools", t("Tools"), "terminal", route.page.startsWith("tools"))}
          {navItem("settings", t("Settings"), "settings", route.page.startsWith("settings"))}
          <ServerPicker
            serversState={props.serversState}
            onServersChange={props.onServersChange}
            connected={reachable}
            started={started}
          />
        </nav>
        <main className="content">
          {route.page === "overview" && <OverviewView />}
          {route.page === "groups" && <GroupsView />}
          {route.page === "connections" && <ConnectionsView />}
          {route.page === "logs" && <LogsView />}
          {route.page === "tools" && <ToolsView />}
          {route.page === "tools/network-quality" && <NetworkQualityView />}
          {route.page === "tools/stun" && <STUNTestView />}
          {route.page === "tools/tailscale" && <TailscaleEndpointView tag={route.tag} />}
          {route.page === "tools/usbip" && <UsbipView tag={route.tag} />}
          {route.page === "settings" && <SettingsView />}
          {route.page === "settings/preferences" && (
            <PreferencesView
              theme={props.theme}
              onThemeChange={props.onThemeChange}
              accent={props.accent}
              onAccentChange={props.onAccentChange}
            />
          )}
          {route.page === "settings/preferences/terminal" && <TerminalConfigurationView />}
          {route.page === "settings/preferences/terminal/theme" && (
            <TerminalThemePickerView scheme={route.scheme} />
          )}
          {route.page === "settings/preferences/terminal/custom" && (
            <TerminalThemeEditorView scheme={route.scheme} />
          )}
          {route.page === "settings/servers" && (
            <ServersView serversState={props.serversState} onServersChange={props.onServersChange} />
          )}
        </main>
        {serviceStatus.phase !== "active" && (
          <div className="reconnect-pill" role="status">
            <Spinner />
            {t("Reconnecting...")}
          </div>
        )}
        {started && <DeprecatedWarningsGate />}
      </div>
    </CapabilitiesContext.Provider>
  );
}

function ServerPicker(props: {
  serversState: ServersState;
  onServersChange: (state: ServersState) => void;
  connected: boolean;
  started: boolean;
}) {
  const { t } = useI18n();
  const { servers, activeId } = props.serversState;
  const active = servers.find((server) => server.id === activeId);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  if (!active) {
    return null;
  }

  return (
    <div className="server-picker" ref={ref}>
      <button className="server-picker-button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="server-picker-text">
          <span className="server-picker-line">
            <span className={props.connected ? "state-dot good" : "state-dot"} />
            <span className="server-name">{serverDisplayName(active)}</span>
          </span>
          {props.started && <ServerUptime />}
        </span>
        <Icon name="unfold_more" size={13} />
      </button>
      {open && (
        <div className="menu open-up">
          {servers.map((server) => (
            <button
              key={server.id}
              className="menu-item"
              onClick={() => {
                setOpen(false);
                if (server.id !== activeId) {
                  props.onServersChange({ ...props.serversState, activeId: server.id });
                }
              }}
            >
              <span className="menu-check">{server.id === activeId && <Icon name="check" size={13} />}</span>
              {serverDisplayName(server)}
            </button>
          ))}
          <div className="menu-divider" />
          <button
            className="menu-item"
            onClick={() => {
              setOpen(false);
              navigate("settings/servers");
            }}
          >
            <span className="menu-check">
              <Icon name="settings" size={13} />
            </span>
            {t("Manage servers...")}
          </button>
        </div>
      )}
    </div>
  );
}

function ServerUptime() {
  const api = useApi();
  const { t, language } = useI18n();
  const now = useNow();
  const startedAt = useUnaryOnce(() => api.getStartedAt());

  if (startedAt === null) {
    return null;
  }
  return (
    <span className="server-uptime" title={`${t("Uptime")} — ${formatDateTime(startedAt, language)}`}>
      <Icon name="power_settings_new" size={10} />
      {formatUptime(startedAt, now)}
    </span>
  );
}

function DeprecatedWarningsGate() {
  const api = useApi();
  const warnings = useUnaryOnce(() => api.getDeprecatedWarnings());
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  const current = warnings?.[index];
  if (!current || !visible) {
    return null;
  }

  const dismiss = () => {
    setVisible(false);
    setTimeout(() => {
      setIndex((value) => value + 1);
      setVisible(true);
    }, 300);
  };

  return <DeprecatedWarningDialog warning={current} onDismiss={dismiss} />;
}

function DeprecatedWarningDialog(props: { warning: DeprecatedWarning; onDismiss: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog onClose={props.onDismiss}>
      <h3>{t("Deprecated Warning")}</h3>
      <p className="dialog-message">{props.warning.message}</p>
      <div className="row-actions dialog-actions">
        <button className="button" onClick={props.onDismiss}>
          {t("Ok")}
        </button>
        {isHttpUrl(props.warning.migrationLink) && (
          <a
            className="button primary"
            href={props.warning.migrationLink}
            target="_blank"
            rel="noreferrer"
            onClick={props.onDismiss}
          >
            {t("Documentation")}
          </a>
        )}
      </div>
    </Dialog>
  );
}
