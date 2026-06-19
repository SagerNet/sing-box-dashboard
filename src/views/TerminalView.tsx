import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { useStream } from "../api/stream";
import { GrpcWebSocketStream } from "../api/websocket";
import { useApi, useIsMobile } from "../app/context";
import { useKeyboardInset, useTerminalConfig } from "../app/hooks";
import { useI18n } from "../app/i18n";
import { Icon } from "../components/Icon";
import { SYMBOL_BAR_HEIGHT, TerminalSymbolBar } from "../components/TerminalSymbolBar";
import { EmptyState, MenuItem, OthersMenu, Spinner, SubMenu } from "../components/ui";
import {
  armModifier,
  consumeArmed,
  encodeSpecial,
  encodeText,
  hasActiveModifier,
  type ModKey,
  type Modifiers,
  type TerminalKey,
} from "../lib/terminalKeys";
import {
  TailscaleSSHClientMessageSchema,
  TailscaleSSHServerMessageSchema,
} from "../gen/daemon/started_service_pb";
import {
  allPeers,
  buildSSHSession,
  loadSSHPrefs,
  peerDisplayName,
  peerSSHAddress,
  peerSSHAvailable,
  SSH_DEFAULT_TERMINAL_TYPE,
  SSH_DEFAULT_USERNAME,
  type SSHSessionOptions,
} from "../lib/tailscaleSSH";
import {
  currentScheme,
  resolveTheme,
  resolveThemeSync,
  terminalFontFamily,
  terminalFontSize,
  type Scheme,
} from "../lib/terminalTheme";

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
  const peer = allPeers(endpoint).find((entry) => entry.stableID === props.peerID);

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
  title: string;
  statusLine: string | null;
}

function sessionDisplayTitle(session: ManagedSession): string {
  const remote = session.title.trim();
  return remote !== "" ? remote : `${session.options.username}@${session.options.peerName}`;
}

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

  const prefs = loadSSHPrefs();
  const endpoint = tailscale.data.endpoints.find((entry) => entry.endpointTag === props.tag);
  const rememberedPeers = allPeers(endpoint).filter(
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
    const peer = allPeers(endpoint).find((entry) => entry.stableID === stableID);
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

const BANNER_URL_REGEX = /(https?:\/\/[^\s]+)/g;

function linkifyBanner(text: string): ReactNode[] {
  return text.split(BANNER_URL_REGEX).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
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

  const isMobile = useIsMobile();
  const keyboardInset = useKeyboardInset();
  const config = useTerminalConfig();
  const { symbolBarAlwaysShow } = config;
  const configRef = useRef(config);
  configRef.current = config;
  const [scheme, setScheme] = useState<Scheme>(() => currentScheme());
  const [activeTheme, setActiveTheme] = useState<ITheme>(() => resolveThemeSync(config, scheme));
  const [connecting, setConnecting] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [modifiers, setModifiers] = useState<Modifiers>({ ctrl: "off", alt: "off" });
  const modifiersRef = useRef(modifiers);
  modifiersRef.current = modifiers;
  const armedAtRef = useRef<Record<ModKey, number>>({ ctrl: 0, alt: 0 });
  const sendRawRef = useRef<((text: string) => void) | null>(null);

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
    const initialConfig = configRef.current;
    const terminal = new Terminal({
      fontFamily: terminalFontFamily(initialConfig),
      fontSize: terminalFontSize(initialConfig),
      cursorBlink: true,
      theme: resolveThemeSync(initialConfig, currentScheme()),
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
            setBanner(message.message.value.message);
            break;
          case "ready":
            ready = true;
            lastStatus = null;
            setStatusLine(null);
            setConnecting(false);
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
            setConnecting(false);
            onExitRef.current(exit.exitCode === 0 && exit.errorMessage === "");
            break;
          }
          case "error":
            lastStatus = message.message.value.message;
            setStatusLine(lastStatus);
            setConnecting(false);
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
        setConnecting(false);
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
    const sendRaw = (text: string) => {
      stream.send({
        message: {
          case: "input",
          value: { data: encoder.encode(text) },
        },
      });
    };
    sendRawRef.current = sendRaw;
    const dataSubscription = terminal.onData((data) => {
      const mods = modifiersRef.current;
      if (hasActiveModifier(mods)) {
        sendRaw(encodeText(data, mods));
        setModifiers((current) => consumeArmed(current));
      } else {
        sendRaw(data);
      }
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
      sendRawRef.current = null;
    };
  }, [api, props.session]);

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

  // Track the app's effective light/dark appearance (written to
  // <html data-theme>) so the terminal can pick the matching theme slot.
  useEffect(() => {
    const observer = new MutationObserver(() => setScheme(currentScheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    setScheme(currentScheme());
    return () => observer.disconnect();
  }, []);

  // Apply font and theme changes to the live terminal without recreating it
  // (which would tear down the SSH session).
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    terminal.options.fontFamily = terminalFontFamily(config);
    terminal.options.fontSize = terminalFontSize(config);
    let cancelled = false;
    void resolveTheme(config, scheme).then((theme) => {
      if (cancelled) {
        return;
      }
      const term = terminalRef.current;
      if (!term) {
        return;
      }
      term.options.theme = theme;
      setActiveTheme(theme);
      fitRef.current?.fit();
    });
    return () => {
      cancelled = true;
    };
  }, [config, scheme]);

  const handleModifier = (mod: ModKey) => {
    const now = Date.now();
    const doubleTap = now - armedAtRef.current[mod] < 300;
    armedAtRef.current[mod] = now;
    setModifiers((current) => armModifier(current, mod, doubleTap));
    terminalRef.current?.focus();
  };

  const handleKey = (key: TerminalKey) => {
    const mods = modifiersRef.current;
    let seq: string | null = null;
    if (key.kind === "special") {
      seq = encodeSpecial(key.id, mods);
    } else if (key.kind === "text") {
      seq = encodeText(key.char, mods);
    }
    if (seq !== null) {
      sendRawRef.current?.(seq);
    }
    setModifiers((current) => consumeArmed(current));
    terminalRef.current?.focus();
  };

  const handlePaste = () => {
    const clipboard = navigator.clipboard;
    if (clipboard?.readText) {
      void clipboard.readText().then(
        (text) => {
          if (text) {
            sendRawRef.current?.(text);
          }
        },
        () => {},
      );
    }
    setModifiers((current) => consumeArmed(current));
    terminalRef.current?.focus();
  };

  // On mobile the bar is purely keyboard-gated: it appears above the keyboard
  // and hides when there is no keyboard (never resting at the bottom). The
  // "always show" toggle only adds the desktop case, where there is no keyboard.
  const keyboardVisible = isMobile && keyboardInset > 100;
  const barVisible = props.active && (keyboardVisible || (symbolBarAlwaysShow && !isMobile));
  const hostStyle: CSSProperties = {};
  if (activeTheme.background) {
    hostStyle.background = activeTheme.background;
  }
  if (barVisible) {
    hostStyle.paddingBottom = `calc(${keyboardInset + SYMBOL_BAR_HEIGHT + 8}px + env(safe-area-inset-bottom, 0px))`;
  }

  return (
    <>
      <div className="terminal-host-wrap" style={!props.active ? { display: "none" } : undefined}>
        <div
          className="terminal-host"
          style={Object.keys(hostStyle).length > 0 ? hostStyle : undefined}
          ref={hostRef}
        />
        {props.active && connecting && (
          <div className="terminal-connecting">
            <Spinner />
            {banner ? (
              <div className="card terminal-banner">{linkifyBanner(banner)}</div>
            ) : (
              <span className="terminal-connecting-label">{t("Connecting...")}</span>
            )}
          </div>
        )}
      </div>
      {barVisible && (
        <TerminalSymbolBar
          modifiers={modifiers}
          onModifier={handleModifier}
          onKey={handleKey}
          onPaste={handlePaste}
          style={{ bottom: keyboardInset }}
        />
      )}
    </>
  );
}
