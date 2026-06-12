import { useEffect, useRef, useState } from "react";

import { formatRelativeTime } from "../api/format";
import { useStream } from "../api/stream";
import { navigate, useApi, useIsMobile, useNow } from "../app/context";
import { useI18n } from "../app/i18n";
import { Icon, type IconName } from "../components/Icon";
import { StreamBanner } from "../components/StreamBanner";
import {
  Badge,
  Card,
  CopyValue,
  DataLine,
  Dialog,
  Drawer,
  EmptyState,
  Field,
  MenuItem,
  OthersMenu,
  QRCode,
  Sparkline,
  Toggle,
} from "../components/ui";
import type {
  TailscaleEndpointStatus,
  TailscalePeer,
  TailscalePingResponse,
} from "../gen/daemon/started_service_pb";
import {
  buildSSHSession,
  loadSSHPrefs,
  peerDisplayName,
  saveSSHPrefs,
  SSH_DEFAULT_TERMINAL_TYPE,
  SSH_DEFAULT_USERNAME,
  type SSHSessionOptions,
} from "../lib/tailscaleSSH";
import { TerminalOverlay } from "./TerminalView";
import { ToolsPageHeader } from "./ToolsView";

export function TailscaleEndpointView(props: { tag: string }) {
  const api = useApi();
  const { t } = useI18n();
  const tailscale = useStream(api.tailscale);
  const isMobile = useIsMobile();
  const [peerDetail, setPeerDetail] = useState<string | null>(null);
  const [sshPromptPeer, setSSHPromptPeer] = useState<TailscalePeer | null>(null);
  const [mobileSSH, setMobileSSH] = useState<SSHSessionOptions | null>(null);
  const [exitPickerOpen, setExitPickerOpen] = useState(false);
  const [authQROpen, setAuthQROpen] = useState(false);
  const [search, setSearch] = useState("");

  const endpoint = tailscale.data.endpoints.find((entry) => entry.endpointTag === props.tag);
  const allPeers = endpoint?.userGroups.flatMap((group) => group.peers) ?? [];
  const exitNodeCandidates = allPeers.filter((peer) => peer.exitNodeOption);
  const running = endpoint?.backendState === "Running";
  const detailPeer =
    peerDetail === "self"
      ? endpoint?.self
      : allPeers.find((peer) => peer.stableID === peerDetail);

  // On desktop SSH opens a dedicated popup browser window, mirroring
  // openWindow on macOS; the session is encoded in the URL so the window is
  // self-contained. If the popup is blocked, fall back to navigating the
  // current tab. On mobile it presents as a full-screen overlay instead,
  // like the full-screen terminal sheet on iOS.
  const openSSHSession = (peer: TailscalePeer, username: string, terminalType: string) => {
    if (isMobile) {
      setMobileSSH(buildSSHSession(props.tag, peer, username, terminalType));
      return;
    }
    const path =
      `tools/tailscale/${encodeURIComponent(props.tag)}/ssh/${encodeURIComponent(peer.stableID)}` +
      `?username=${encodeURIComponent(username)}&terminalType=${encodeURIComponent(terminalType)}`;
    const url = new URL(location.href);
    url.hash = `#/${path}`;
    if (!window.open(url.toString(), "_blank", "width=960,height=640")) {
      navigate(path);
    }
  };

  // Remembered peers connect immediately; everything else goes through the
  // prompt first, mirroring the quick-connect context menu on Apple platforms.
  const connectSSH = (peer: TailscalePeer) => {
    const prefs = loadSSHPrefs()[peer.stableID];
    if (prefs?.remember) {
      openSSHSession(peer, prefs.username, prefs.terminalType);
    } else {
      setSSHPromptPeer(peer);
    }
  };

  const dialogs = (
    <>
      {endpoint && exitPickerOpen && (
        <ExitNodePicker
          endpoint={endpoint}
          candidates={exitNodeCandidates}
          onClose={() => setExitPickerOpen(false)}
        />
      )}
      {endpoint && authQROpen && endpoint.authURL !== "" && (
        <Dialog className="qr-dialog" onClose={() => setAuthQROpen(false)}>
          <h3>{t("Auth URL")}</h3>
          <QRCode value={endpoint.authURL} />
          <CopyValue value={endpoint.authURL} />
        </Dialog>
      )}
      {sshPromptPeer && (
        <SSHPrompt
          key={sshPromptPeer.stableID}
          peer={sshPromptPeer}
          onCancel={() => setSSHPromptPeer(null)}
          onConnect={(username, terminalType, remember) => {
            saveSSHPrefs(sshPromptPeer.stableID, { username, terminalType, remember });
            setSSHPromptPeer(null);
            openSSHSession(sshPromptPeer, username, terminalType);
          }}
        />
      )}
      {mobileSSH && (
        <TerminalOverlay
          tag={props.tag}
          initialSession={mobileSSH}
          onClose={() => setMobileSSH(null)}
        />
      )}
    </>
  );

  // On mobile the peer detail replaces the endpoint page as a pushed
  // sub-page, like the Tools sub-pages; on desktop it stays a side drawer.
  if (isMobile && endpoint && detailPeer) {
    return (
      <div className="page">
        <div className="page-header">
          <button className="back-button" onClick={() => setPeerDetail(null)}>
            <Icon name="arrow_back" size={15} />
            Tailscale
          </button>
          <h1 className="page-title">{peerDisplayName(detailPeer)}</h1>
        </div>
        <div className="hint" style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span className={`state-dot ${detailPeer.online ? "good" : ""}`} />
          {detailPeer.online ? t("Connected") : t("Not connected")}
        </div>
        <PeerDetailBody
          endpoint={endpoint}
          peer={detailPeer}
          isSelf={peerDetail === "self"}
          onClose={() => setPeerDetail(null)}
          onConnectSSH={() => connectSSH(detailPeer)}
          onEditSSH={() => setSSHPromptPeer(detailPeer)}
        />
        {dialogs}
      </div>
    );
  }

  return (
    <div className="page">
      <ToolsPageHeader
        title={props.tag === "" ? "Tailscale" : t("Tailscale: {tag}", { tag: props.tag })}
      />
      <StreamBanner snapshot={tailscale} subject="Tailscale status" />
      {!tailscale.data.loaded && tailscale.phase !== "error" && (
        <EmptyState>{t("Loading...")}</EmptyState>
      )}
      {tailscale.data.loaded && !endpoint && (
        <EmptyState icon="hub">{t("Endpoint not found")}</EmptyState>
      )}
      {endpoint && (
        <div className="settings-stack">
          <StatusCard
            endpoint={endpoint}
            hasExitNodes={exitNodeCandidates.length > 0}
            onShowSelf={() => setPeerDetail("self")}
            onOpenExitPicker={() => setExitPickerOpen(true)}
            onOpenAuthQR={() => setAuthQROpen(true)}
          />
          {running && allPeers.length > 0 && (
            <>
              <div className="search-input">
                <Icon name="search" size={14} />
                <input
                  className="input"
                  placeholder={t("Search")}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <PeerSections
                endpoint={endpoint}
                search={search}
                onShowPeer={setPeerDetail}
                onConnectSSH={connectSSH}
              />
            </>
          )}
        </div>
      )}
      {endpoint && detailPeer && (
        <PeerDetail
          endpoint={endpoint}
          peer={detailPeer}
          isSelf={peerDetail === "self"}
          onClose={() => setPeerDetail(null)}
          onConnectSSH={() => connectSSH(detailPeer)}
          onEditSSH={() => setSSHPromptPeer(detailPeer)}
        />
      )}
      {dialogs}
    </div>
  );
}

function backendStateTone(state: string): string {
  switch (state) {
    case "Running":
      return "good";
    case "NeedsLogin":
    case "NeedsMachineAuth":
      return "bad";
    case "Starting":
      return "medium";
    default:
      return "";
  }
}

function StatusCard(props: {
  endpoint: TailscaleEndpointStatus;
  hasExitNodes: boolean;
  onShowSelf: () => void;
  onOpenExitPicker: () => void;
  onOpenAuthQR: () => void;
}) {
  const { t } = useI18n();
  const endpoint = props.endpoint;
  const running = endpoint.backendState === "Running";

  return (
    <Card title={t("Status")}>
      <div className="nav-lines">
        <div className="nav-line static">
          <Icon name="power_settings_new" size={15} />
          <span className="nav-line-label">{t("State")}</span>
          <span className="nav-line-value">
            <span className={`state-dot ${backendStateTone(endpoint.backendState)}`} />
            {endpoint.backendState || t("Unknown")}
          </span>
        </div>
        {running && endpoint.self && (
          <NavLine
            icon="computer"
            label={t("This device")}
            value={peerDisplayName(endpoint.self)}
            onClick={props.onShowSelf}
          />
        )}
        {running && props.hasExitNodes && (
          <NavLine
            icon="router"
            label={t("Exit node")}
            value={endpoint.exitNode ? peerDisplayName(endpoint.exitNode) : t("Disabled")}
            onClick={props.onOpenExitPicker}
          />
        )}
      </div>
      {endpoint.authURL !== "" && (
        <DataLine
          label={t("Login")}
          value={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <a className="icon-link" href={endpoint.authURL} target="_blank" rel="noreferrer">
                <Icon name="open_in_new" size={13} />
                {t("Open auth URL")}
              </a>
              <span style={{ color: "var(--text-faint)" }}>·</span>
              <button className="link-button icon-link" onClick={props.onOpenAuthQR}>
                <Icon name="qr_code" size={13} />
                {t("QR code")}
              </button>
            </span>
          }
        />
      )}
    </Card>
  );
}

// Rows inside the Status card, mirroring the State/This Device/Exit Node
// ListItems in sing-box-for-android (PowerSettingsNew/Computer/Router icons).
function NavLine(props: { icon: IconName; label: string; value: string; onClick: () => void }) {
  return (
    <button className="nav-line" onClick={props.onClick}>
      <Icon name={props.icon} size={15} />
      <span className="nav-line-label">{props.label}</span>
      <span className="nav-line-value">{props.value}</span>
      <Icon name="keyboard_arrow_right" size={14} />
    </button>
  );
}

function peerMatches(peer: TailscalePeer, query: string): boolean {
  if (query === "") {
    return true;
  }
  return (
    peerDisplayName(peer).toLowerCase().includes(query) ||
    peer.hostName.toLowerCase().includes(query) ||
    peer.dnsName.toLowerCase().includes(query) ||
    peer.tailscaleIPs.some((address) => address.includes(query))
  );
}

function PeerSections(props: {
  endpoint: TailscaleEndpointStatus;
  search: string;
  onShowPeer: (id: string) => void;
  onConnectSSH: (peer: TailscalePeer) => void;
}) {
  const { t } = useI18n();
  const query = props.search.trim().toLowerCase();
  const groups = props.endpoint.userGroups
    .map((group) => ({ group, peers: group.peers.filter((peer) => peerMatches(peer, query)) }))
    .filter((entry) => entry.peers.length > 0);

  if (groups.length === 0) {
    return <EmptyState icon="search">{t("No matching peers")}</EmptyState>;
  }

  return (
    <>
      {groups.map(({ group, peers }) => (
        <div key={group.userID.toString()}>
          <div className="list-section-title">{group.displayName || group.loginName}</div>
          <div className="peer-list">
            {peers.map((peer) => (
              <PeerRow
                key={peer.stableID}
                peer={peer}
                onOpen={() => props.onShowPeer(peer.stableID)}
                onConnectSSH={
                  peer.online && peer.sshHostKeys.length > 0 && peer.tailscaleIPs.length > 0
                    ? () => props.onConnectSSH(peer)
                    : undefined
                }
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function PeerRow(props: { peer: TailscalePeer; onOpen: () => void; onConnectSSH?: () => void }) {
  const { t, language } = useI18n();
  const peer = props.peer;
  const now = useNow(30_000);
  return (
    <div className="peer-item">
      <button className="peer-item-main" onClick={props.onOpen}>
        <span className={`state-dot ${peer.online ? "good" : ""}`} />
        <span className="peer-name">{peerDisplayName(peer)}</span>
        <span className="peer-address">{peer.tailscaleIPs[0] ?? ""}</span>
        <span className="badges">
          {peer.shareeNode && <Badge tone="danger">{t("Shared in")}</Badge>}
          {peer.exitNode && <Badge tone="info">{t("Exit node")}</Badge>}
          {peer.expired && <Badge tone="danger">{t("Expired")}</Badge>}
          {!peer.expired &&
            peer.keyExpiry > 0n &&
            Number(peer.keyExpiry) * 1000 - now < 30 * 86400_000 && (
              <Badge>
                {t("Expires {time}", {
                  time: formatRelativeTime(Number(peer.keyExpiry) * 1000, now, language),
                })}
              </Badge>
            )}
          {peer.sshHostKeys.length > 0 && <Badge tone="good">SSH</Badge>}
        </span>
      </button>
      {props.onConnectSSH && (
        <OthersMenu icon="more_horiz">
          <MenuItem icon="terminal" onSelect={props.onConnectSSH}>
            {t("Connect via SSH")}
          </MenuItem>
        </OthersMenu>
      )}
    </div>
  );
}

function PeerDetail(props: {
  endpoint: TailscaleEndpointStatus;
  peer: TailscalePeer;
  isSelf: boolean;
  onClose: () => void;
  onConnectSSH: () => void;
  onEditSSH: () => void;
}) {
  const { t } = useI18n();
  const peer = props.peer;
  return (
    <Drawer onClose={props.onClose}>
      <h3>
        <span className={`state-dot ${peer.online ? "good" : ""}`} />
        {peerDisplayName(peer)}
      </h3>
      <div className="hint">{peer.online ? t("Connected") : t("Not connected")}</div>
      <PeerDetailBody {...props} />
    </Drawer>
  );
}

function PeerDetailBody(props: {
  endpoint: TailscaleEndpointStatus;
  peer: TailscalePeer;
  isSelf: boolean;
  onClose: () => void;
  onConnectSSH: () => void;
  onEditSSH: () => void;
}) {
  const api = useApi();
  const { t, language } = useI18n();
  const peer = props.peer;
  const now = useNow(30_000);
  const ipv4 = peer.tailscaleIPs.find((address) => !address.includes(":"));
  const ipv6 = peer.tailscaleIPs.find((address) => address.includes(":"));
  const sshAvailable = !props.isSelf && peer.online && peer.sshHostKeys.length > 0;
  const sshRemembered = loadSSHPrefs()[peer.stableID]?.remember ?? false;
  const canLogout = props.isSelf && !props.endpoint.keyAuth;

  return (
    <>
      {props.isSelf && (props.endpoint.networkName !== "" || canLogout) && (
        <>
          <div className="drawer-section">{t("Network")}</div>
          {props.endpoint.networkName !== "" && (
            <DataLine label={t("Network")} value={props.endpoint.networkName} />
          )}
          {canLogout && (
            <div className="row-actions" style={{ marginTop: 6 }}>
              <button
                className="button danger small"
                onClick={() => {
                  if (confirm(t("Log out from this Tailscale network?"))) {
                    void api.tailscaleLogout(props.endpoint.endpointTag).catch(() => {});
                    props.onClose();
                  }
                }}
              >
                <Icon name="logout" size={13} />
                {t("Log out")}
              </button>
            </div>
          )}
        </>
      )}

      <div className="drawer-section">{t("Addresses")}</div>
      {peer.dnsName !== "" && (
        <DataLine label="MagicDNS" value={<CopyValue value={peer.dnsName.replace(/\.$/, "")} />} />
      )}
      <DataLine label={t("Hostname")} value={<CopyValue value={peer.hostName} />} />
      {ipv4 && <DataLine label="IPv4" value={<CopyValue value={ipv4} />} />}
      {ipv6 && <DataLine label="IPv6" value={<CopyValue value={ipv6} />} />}

      {!props.isSelf && peer.online && (
        <PingSection endpoint={props.endpoint} peer={peer} />
      )}

      <div className="drawer-section">{t("Details")}</div>
      {peer.os !== "" && <DataLine label={t("OS")} value={peer.os} />}
      <DataLine
        label={t("Key expiry")}
        value={
          peer.expired
            ? t("Expired")
            : peer.keyExpiry > 0n
              ? formatRelativeTime(Number(peer.keyExpiry) * 1000, now, language)
              : t("Disabled")
        }
      />
      {!peer.online && peer.lastSeen > 0n && (
        <DataLine
          label={t("Last seen")}
          value={formatRelativeTime(Number(peer.lastSeen) * 1000, now, language)}
        />
      )}
      {peer.exitNodeOption && (
        <DataLine label={t("Exit node")} value={peer.exitNode ? t("Active") : t("Available")} />
      )}
      {peer.shareeNode && <DataLine label={t("Shared in")} value={t("Yes")} />}
      {sshAvailable && (
        <>
          <hr className="divider" />
          <div className="row-actions">
            {sshRemembered && (
              <button className="button" onClick={props.onEditSSH}>
                <Icon name="edit" size={13} />
                {t("Edit")}
              </button>
            )}
            <button className="button primary" onClick={props.onConnectSSH}>
              <Icon name="terminal" size={13} />
              {t("Connect via SSH")}
            </button>
          </div>
        </>
      )}
    </>
  );
}

function PingSection(props: { endpoint: TailscaleEndpointStatus; peer: TailscalePeer }) {
  const api = useApi();
  const { t } = useI18n();
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<number[]>([]);
  const [latest, setLatest] = useState<TailscalePingResponse | null>(null);
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const start = async () => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setError("");
    setHistory([]);
    setLatest(null);
    try {
      for await (const response of api.client.startTailscalePing(
        {
          endpointTag: props.endpoint.endpointTag,
          peerIP: props.peer.tailscaleIPs[0] ?? "",
        },
        { signal: controller.signal },
      )) {
        if (response.error !== "") {
          setError(response.error);
          continue;
        }
        setLatest(response);
        setHistory((current) => {
          const next = current.concat(response.latencyMs);
          return next.length > 30 ? next.slice(next.length - 30) : next;
        });
      }
    } catch (streamError) {
      if (!controller.signal.aborted) {
        setError(String(streamError));
      }
    } finally {
      setRunning(false);
    }
  };

  const stop = () => {
    controllerRef.current?.abort();
    setRunning(false);
  };

  return (
    <>
      <div className="drawer-section" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {t("Ping")}
        <button
          className="icon-button"
          style={{ marginInlineStart: "auto" }}
          title={running ? t("Stop") : t("Start")}
          onClick={() => (running ? stop() : void start())}
        >
          <Icon name={running ? "stop" : "play_arrow"} size={13} />
        </button>
      </div>
      {error !== "" && <div className="hint" style={{ color: "var(--danger)" }}>{error}</div>}
      {latest && (
        <>
          <DataLine
            label={latest.isDirect ? t("Direct connection") : t("DERP-relayed connection")}
            value={`${latest.latencyMs.toFixed(1)} ms`}
          />
          {!latest.isDirect && latest.derpRegionCode !== "" && (
            <DataLine label={t("DERP region")} value={latest.derpRegionCode} />
          )}
          {latest.isDirect && latest.endpoint !== "" && (
            <DataLine label={t("Endpoint")} value={latest.endpoint} />
          )}
          <Sparkline
            data={history}
            color={latest.isDirect ? "var(--good)" : "var(--info)"}
            height={56}
          />
        </>
      )}
      {!latest && !running && <div className="hint">{t("No data")}</div>}
    </>
  );
}

function ExitNodePicker(props: {
  endpoint: TailscaleEndpointStatus;
  candidates: TailscalePeer[];
  onClose: () => void;
}) {
  const api = useApi();
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const current = props.endpoint.exitNode?.stableID ?? "";

  const select = (stableID: string) => {
    void api.setTailscaleExitNode(props.endpoint.endpointTag, stableID).catch(() => {});
    props.onClose();
  };

  const filtered = props.candidates.filter((peer) =>
    peerMatches(peer, search.trim().toLowerCase()),
  );

  return (
    <Dialog onClose={props.onClose}>
      <h3>{t("Exit node")}</h3>
      <Field label={t("Search")}>
        <input
          className="input"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          autoFocus
        />
      </Field>
      <button className="peer-row" onClick={() => select("")}>
        <span className="peer-name">{t("Disabled")}</span>
        {current === "" && (
          <span className="badges">
            <Icon name="check" size={14} />
          </span>
        )}
      </button>
      {filtered.map((peer) => (
        <button className="peer-row" key={peer.stableID} onClick={() => select(peer.stableID)}>
          <span className={`state-dot ${peer.online ? "good" : ""}`} />
          <span className="peer-name">{peerDisplayName(peer)}</span>
          <span className="peer-address">{peer.tailscaleIPs[0] ?? ""}</span>
          {current === peer.stableID && (
            <span className="badges">
              <Icon name="check" size={14} />
            </span>
          )}
        </button>
      ))}
    </Dialog>
  );
}

function SSHPrompt(props: {
  peer: TailscalePeer;
  onCancel: () => void;
  onConnect: (username: string, terminalType: string, remember: boolean) => void;
}) {
  const { t } = useI18n();
  const [initial] = useState(() => loadSSHPrefs()[props.peer.stableID]);
  const [username, setUsername] = useState(initial?.username ?? SSH_DEFAULT_USERNAME);
  const [terminalType, setTerminalType] = useState(
    initial?.terminalType ?? SSH_DEFAULT_TERMINAL_TYPE,
  );
  const [remember, setRemember] = useState(initial?.remember ?? false);

  const connect = () => {
    const trimmed = username.trim();
    if (trimmed === "") {
      return;
    }
    props.onConnect(trimmed, terminalType.trim() || SSH_DEFAULT_TERMINAL_TYPE, remember);
  };

  return (
    <Dialog onClose={props.onCancel}>
      <h3>{t("Connect via SSH")}</h3>
      <div className="hint" style={{ marginBottom: 12 }}>{peerDisplayName(props.peer)}</div>
      <Field label={t("Username")}>
        <input
          className="input"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              connect();
            }
          }}
          autoFocus
        />
      </Field>
      <Field label={t("Terminal type")}>
        <input
          className="input"
          value={terminalType}
          onChange={(event) => setTerminalType(event.target.value)}
        />
      </Field>
      <Toggle label={t("Remember SSH options")} value={remember} onChange={setRemember} />
      {remember && (
        <div className="hint">
          {t("Connect will open the session directly without asking again.")}
        </div>
      )}
      <div className="row-actions" style={{ marginTop: 14 }}>
        <button className="button" onClick={props.onCancel}>
          {t("Cancel")}
        </button>
        <button className="button primary" disabled={username.trim() === ""} onClick={connect}>
          {t("Connect")}
        </button>
      </div>
    </Dialog>
  );
}
