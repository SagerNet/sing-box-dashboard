import { useEffect, useRef, useState } from "react";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { useStream } from "../api/stream";
import { GrpcWebSocketStream } from "../api/websocket";
import { useApi } from "../app/context";
import { useI18n } from "../app/i18n";
import { Icon } from "../components/Icon";
import { EmptyState, MenuItem, OthersMenu, SubMenu } from "../components/ui";
import {
  TailscaleSSHClientMessageSchema,
  TailscaleSSHServerMessageSchema,
} from "../gen/daemon/started_service_pb";
import {
  buildSSHSession,
  loadSSHPrefs,
  peerDisplayName,
  peerSSHAddress,
  peerSSHAvailable,
  SSH_DEFAULT_TERMINAL_TYPE,
  SSH_DEFAULT_USERNAME,
  type SSHSessionOptions,
} from "../lib/tailscaleSSH";

// SSH session window as a routed page: on desktop it lives in a dedicated
// popup browser window (mirroring the separate terminal window on macOS),
// resolved from the URL alone so it survives a reload on its own.
export function TailscaleSSHView(props: {
  tag: string;
  peerID: string;
  username: string;
  terminalType: string;
}) {
  const api = useApi();
  const { t } = useI18n();
  const tailscale = useStream(api.tailscale);
  const [initialSession, setInitialSession] = useState<SSHSessionOptions | null>(null);

  const endpoint = tailscale.data.endpoints.find((entry) => entry.endpointTag === props.tag);
  const peer = endpoint?.userGroups
    .flatMap((group) => group.peers)
    .find((entry) => entry.stableID === props.peerID);

  // Latch the session options from the first status delivery: later stream
  // updates (peers flapping online/offline) must not tear down the live
  // terminal.
  useEffect(() => {
    if (initialSession || !peer) {
      return;
    }
    setInitialSession(buildSSHSession(props.tag, peer, props.username, props.terminalType));
  }, [initialSession, peer, props.tag, props.username, props.terminalType]);

  if (!initialSession) {
    return (
      <div className="page page-full terminal-page">
        <div className="page-header">
          <h1 className="page-title">SSH</h1>
        </div>
        {tailscale.data.loaded ? (
          <EmptyState icon="terminal">{t("Peer not found")}</EmptyState>
        ) : (
          <EmptyState>{t("Loading...")}</EmptyState>
        )}
      </div>
    );
  }

  return (
    <div className="page page-full terminal-page">
      <TerminalContainer tag={props.tag} initialSession={initialSession} setWindowTitle />
    </div>
  );
}

// Mobile counterpart of the popup window: a full-screen overlay above the
// dashboard, like the full-screen terminal sheet on iOS.
export function TerminalOverlay(props: {
  tag: string;
  initialSession: SSHSessionOptions;
  onClose: () => void;
}) {
  return (
    <div className="terminal-overlay">
      <div className="page page-full terminal-page">
        <TerminalContainer
          tag={props.tag}
          initialSession={props.initialSession}
          onClose={props.onClose}
        />
      </div>
    </div>
  );
}

interface ManagedSession {
  id: number;
  options: SSHSessionOptions;
  // Remote title reported via OSC escape sequences; empty until the shell
  // sets one, then it replaces user@host, like the Ghostty title on Apple
  // platforms.
  title: string;
  statusLine: string | null;
}

function sessionDisplayTitle(session: ManagedSession): string {
  const remote = session.title.trim();
  return remote !== "" ? remote : `${session.options.username}@${session.options.peerName}`;
}

// Multi-session terminal with the session manager menu, mirroring
// TerminalSessionManager/TerminalSessionMenuButton in sing-box-for-apple:
// New Session duplicates the active one or opens any other remembered peer;
// the list below switches between live sessions. Sessions that exit cleanly
// close themselves after a second; when the last one goes, the window or
// overlay closes.
function TerminalContainer(props: {
  tag: string;
  initialSession: SSHSessionOptions;
  onClose?: () => void;
  setWindowTitle?: boolean;
}) {
  const api = useApi();
  const { t } = useI18n();
  const tailscale = useStream(api.tailscale);
  const idRef = useRef(1);
  const [state, setState] = useState<{ sessions: ManagedSession[]; activeID: number }>(() => ({
    sessions: [{ id: 1, options: props.initialSession, title: "", statusLine: null }],
    activeID: 1,
  }));

  const active = state.sessions.find((session) => session.id === state.activeID);
  const activeTitle = active ? sessionDisplayTitle(active) : "SSH";

  useEffect(() => {
    if (props.setWindowTitle) {
      document.title = activeTitle;
    }
  }, [props.setWindowTitle, activeTitle]);

  // All sessions gone: close the popup window, or the overlay on mobile.
  // The empty state below stays as a fallback for when the browser refuses
  // to close a window it did not open.
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;
  useEffect(() => {
    if (state.sessions.length > 0) {
      return;
    }
    if (onCloseRef.current) {
      onCloseRef.current();
    } else {
      window.close();
    }
  }, [state.sessions.length]);

  const addSession = (options: SSHSessionOptions) => {
    const id = ++idRef.current;
    setState((current) => ({
      sessions: [...current.sessions, { id, options, title: "", statusLine: null }],
      activeID: id,
    }));
  };

  const updateSession = (id: number, patch: Partial<ManagedSession>) => {
    setState((current) => ({
      ...current,
      sessions: current.sessions.map((session) =>
        session.id === id ? { ...session, ...patch } : session,
      ),
    }));
  };

  const closeSession = (id: number) => {
    setState((current) => {
      const sessions = current.sessions.filter((session) => session.id !== id);
      const activeID =
        current.activeID === id ? (sessions[sessions.length - 1]?.id ?? 0) : current.activeID;
      return { sessions, activeID };
    });
  };

  const handleExit = (id: number, clean: boolean) => {
    if (clean) {
      window.setTimeout(() => closeSession(id), 1000);
    }
  };

  // Other remembered peers reachable from this endpoint, excluding the peer
  // of the active session — the candidates for New Session.
  const prefs = loadSSHPrefs();
  const endpoint = tailscale.data.endpoints.find((entry) => entry.endpointTag === props.tag);
  const rememberedPeers = (endpoint?.userGroups ?? [])
    .flatMap((group) => group.peers)
    .filter(
      (peer) =>
        prefs[peer.stableID]?.remember &&
        peerSSHAvailable(peer) &&
        peerSSHAddress(peer) !== active?.options.peerAddress,
    );

  const duplicateSession = () => {
    if (active) {
      addSession({ ...active.options });
    }
  };

  const openRememberedPeer = (stableID: string) => {
    const peer = (endpoint?.userGroups ?? [])
      .flatMap((group) => group.peers)
      .find((entry) => entry.stableID === stableID);
    if (!peer) {
      return;
    }
    const peerPrefs = prefs[peer.stableID];
    addSession(
      buildSSHSession(
        props.tag,
        peer,
        peerPrefs?.username ?? SSH_DEFAULT_USERNAME,
        peerPrefs?.terminalType ?? SSH_DEFAULT_TERMINAL_TYPE,
      ),
    );
  };

  return (
    <>
      <div className="page-header">
        {props.onClose && (
          <button className="icon-button" title={t("Close")} onClick={props.onClose}>
            <Icon name="close" size={18} />
          </button>
        )}
        <h1 className="page-title">{activeTitle}</h1>
        <div className="actions">
          {active?.statusLine && <span className="hint">{active.statusLine}</span>}
          {state.sessions.length > 0 && (
            <OthersMenu>
              {rememberedPeers.length === 0 ? (
                <MenuItem icon="add" onSelect={duplicateSession}>
                  {t("New Session")}
                </MenuItem>
              ) : (
                <SubMenu label={t("New Session")} icon="add">
                  {active && (
                    <MenuItem icon="content_copy" onSelect={duplicateSession}>
                      {active.options.peerName}
                    </MenuItem>
                  )}
                  {rememberedPeers.map((peer) => (
                    <MenuItem key={peer.stableID} onSelect={() => openRememberedPeer(peer.stableID)}>
                      {peerDisplayName(peer)}
                    </MenuItem>
                  ))}
                </SubMenu>
              )}
              <div className="menu-divider" />
              {state.sessions.map((session) => (
                <MenuItem
                  key={session.id}
                  checked={session.id === state.activeID}
                  onSelect={() => setState((current) => ({ ...current, activeID: session.id }))}
                >
                  {sessionDisplayTitle(session)}
                </MenuItem>
              ))}
            </OthersMenu>
          )}
        </div>
      </div>
      {state.sessions.length === 0 && (
        <EmptyState icon="terminal">{t("Session closed")}</EmptyState>
      )}
      {state.sessions.map((session) => (
        <TerminalSession
          key={session.id}
          session={session.options}
          active={session.id === state.activeID}
          onStatusLine={(line) => updateSession(session.id, { statusLine: line })}
          onTitleChange={(title) => updateSession(session.id, { title })}
          onExit={(clean) => handleExit(session.id, clean)}
        />
      ))}
    </>
  );
}

function TerminalSession(props: {
  session: SSHSessionOptions;
  active: boolean;
  onStatusLine: (line: string | null) => void;
  onTitleChange: (title: string) => void;
  onExit: (clean: boolean) => void;
}) {
  const api = useApi();
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  // Read t and the callbacks through refs inside the stream callbacks: a
  // language switch or parent re-render must not re-run the effect, which
  // would tear down a live SSH session.
  const tRef = useRef(t);
  tRef.current = t;
  const onStatusLineRef = useRef(props.onStatusLine);
  onStatusLineRef.current = props.onStatusLine;
  const onTitleChangeRef = useRef(props.onTitleChange);
  onTitleChangeRef.current = props.onTitleChange;
  const onExitRef = useRef(props.onExit);
  onExitRef.current = props.onExit;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const setStatusLine = (line: string | null) => onStatusLineRef.current(line);
    const terminal = new Terminal({
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: "#181818",
        foreground: "#ededed",
        cursor: "#ededed",
        selectionBackground: "rgba(255, 255, 255, 0.25)",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    fit.fit();
    terminal.focus();
    terminalRef.current = terminal;
    fitRef.current = fit;

    let ready = false;
    let lastStatus: string | null = null;
    const stream = new GrpcWebSocketStream({
      config: api.config,
      service: "daemon.StartedService",
      method: "StartTailscaleSSHSession",
      requestSchema: TailscaleSSHClientMessageSchema,
      responseSchema: TailscaleSSHServerMessageSchema,
      onMessage: (message) => {
        switch (message.message.case) {
          case "authBanner":
            terminal.write(message.message.value.message.replaceAll("\n", "\r\n"));
            break;
          case "ready":
            ready = true;
            lastStatus = null;
            setStatusLine(null);
            break;
          case "output":
            terminal.write(message.message.value.data);
            break;
          case "exit": {
            const exit = message.message.value;
            let text = tRef.current("Session exited with code {code}", { code: exit.exitCode });
            if (exit.signal !== "") {
              text += ` ${tRef.current("(signal {signal})", { signal: exit.signal })}`;
            }
            if (exit.errorMessage !== "") {
              text += `: ${exit.errorMessage}`;
            }
            lastStatus = text;
            setStatusLine(text);
            onExitRef.current(exit.exitCode === 0 && exit.errorMessage === "");
            break;
          }
          case "error":
            lastStatus = message.message.value.message;
            setStatusLine(lastStatus);
            break;
        }
      },
      onEnd: (status, error) => {
        if (status && status.code !== 0) {
          setStatusLine(
            status.message || tRef.current("Stream ended with status {code}", { code: status.code }),
          );
        } else if (error && !ready) {
          setStatusLine(error);
        } else {
          setStatusLine(lastStatus ?? tRef.current("Session closed"));
        }
        terminal.options.cursorBlink = false;
      },
    });

    stream.send({
      message: {
        case: "start",
        value: {
          endpointTag: props.session.endpointTag,
          peerAddress: props.session.peerAddress,
          username: props.session.username,
          terminalType: props.session.terminalType,
          columns: terminal.cols,
          rows: terminal.rows,
          hostKeys: props.session.hostKeys,
        },
      },
    });
    lastStatus = tRef.current("Connecting...");
    setStatusLine(lastStatus);

    const encoder = new TextEncoder();
    const dataSubscription = terminal.onData((data) => {
      stream.send({
        message: {
          case: "input",
          value: { data: encoder.encode(data) },
        },
      });
    });
    const resizeSubscription = terminal.onResize((size) => {
      stream.send({
        message: {
          case: "resize",
          value: { columns: size.cols, rows: size.rows },
        },
      });
    });
    const titleSubscription = terminal.onTitleChange((title) => {
      onTitleChangeRef.current(title);
    });
    // Skip fitting while hidden behind another session: xterm cannot measure
    // a display:none host.
    const resizeObserver = new ResizeObserver(() => {
      if (host.clientWidth > 0 && host.clientHeight > 0) {
        fit.fit();
      }
    });
    resizeObserver.observe(host);

    return () => {
      resizeObserver.disconnect();
      dataSubscription.dispose();
      resizeSubscription.dispose();
      titleSubscription.dispose();
      stream.close();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [api, props.session]);

  // Refit and refocus when this session becomes the visible one.
  useEffect(() => {
    if (!props.active) {
      return;
    }
    const host = hostRef.current;
    if (host && host.clientWidth > 0 && host.clientHeight > 0) {
      fitRef.current?.fit();
    }
    terminalRef.current?.focus();
  }, [props.active]);

  return (
    <div
      className="terminal-host"
      style={props.active ? undefined : { display: "none" }}
      ref={hostRef}
    />
  );
}
