import { useState } from "react";

import { formatRelativeTime, isHttpUrl, type DelayTone } from "../api/format";
import { useStream } from "../api/stream";
import { navigate, useApi, useIsMobile, useNow } from "../app/context";
import { showError } from "../app/errorStore";
import { useStreamingAction } from "../app/hooks";
import { useI18n } from "../app/i18n";
import { Icon, type IconName } from "../components/Icon";
import { StreamStates } from "../components/StreamBanner";
import {
  Badge,
  Button,
  Card,
  CopyValue,
  DataLine,
  DetailSection,
  DetailShell,
  Dialog,
  Field,
  IconButton,
  MenuItem,
  OthersMenu,
  QRCode,
  Sparkline,
  StateDot,
  Toggle,
} from "../components/ui";
import type {
  TailscaleEndpointStatus,
  TailscalePeer,
  TailscalePingResponse,
} from "../gen/daemon/started_service_pb";
import {
  allPeers,
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
import styles from "./TailscaleView.module.css";
import { cx } from "../lib/cx";

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

  const endpoint = tailscale.data.endpoints.find((entry) => entry.endpointTag === props.tag);
  const peers = allPeers(endpoint);
  const exitNodeCandidates = peers.filter((peer) => peer.exitNodeOption);
  const running = endpoint?.backendState === "Running";
  const detailPeer =
    peerDetail === "self"
      ? endpoint?.self
      : peers.find((peer) => peer.stableID === peerDetail);

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
        <Dialog onClose={() => setAuthQROpen(false)}>
          <h3>{t("Auth URL")}</h3>
          <QRCode value={endpoint.authURL} />
          <CopyValue value={endpoint.authURL} className={styles.qrCopy} />
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

  const detail = endpoint && detailPeer && (
    <DetailShell
      backLabel="Tailscale"
      title={peerDisplayName(detailPeer)}
      accessory={
        <Badge tone={detailPeer.online ? "good" : "neutral"}>
          {detailPeer.online ? t("Connected") : t("Not connected")}
        </Badge>
      }
      onClose={() => setPeerDetail(null)}
    >
      <PeerDetailBody
        endpoint={endpoint}
        peer={detailPeer}
        isSelf={peerDetail === "self"}
        onClose={() => setPeerDetail(null)}
        onConnectSSH={() => connectSSH(detailPeer)}
        onEditSSH={() => setSSHPromptPeer(detailPeer)}
      />
    </DetailShell>
  );

  if (isMobile && detail) {
    return (
      <>
        {detail}
        {dialogs}
      </>
    );
  }

  return (
    <div className="page">
      <ToolsPageHeader
        title={
          tailscale.data.endpoints.length > 1 && props.tag !== ""
            ? t("Tailscale: {tag}", { tag: props.tag })
            : "Tailscale"
        }
      />
      <StreamStates
        snapshot={tailscale}
        subject="Tailscale status"
        loaded={tailscale.data.loaded}
        empty={!endpoint}
        emptyIcon="hub"
        emptyMessage={t("Endpoint not found")}
      />
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
            <PeerSections
              endpoint={endpoint}
              onShowPeer={setPeerDetail}
              onConnectSSH={connectSSH}
            />
          )}
        </div>
      )}
      {detail}
      {dialogs}
    </div>
  );
}

function backendStateTone(state: string): DelayTone {
  switch (state) {
    case "Running":
      return "good";
    case "NeedsLogin":
    case "NeedsMachineAuth":
      return "bad";
    case "Starting":
      return "medium";
    default:
      return "neutral";
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
    <div>
      <div className="list-section-title">{t("Status")}</div>
      <Card>
        <div className={styles.navLines}>
          <div className={cx(styles.navLine, styles.static)}>
            <Icon name="power_settings_new" size={15} />
            <span className={styles.navLineLabel}>{t("State")}</span>
            <span className={styles.navLineValue}>
              <StateDot tone={backendStateTone(endpoint.backendState)} />
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
          {endpoint.authURL !== "" && (
            <>
              {isHttpUrl(endpoint.authURL) && (
                <a className={styles.navLine} href={endpoint.authURL} target="_blank" rel="noreferrer">
                  <Icon name="open_in_new" size={15} />
                  <span className={styles.navLineLabel}>{t("Open auth URL")}</span>
                </a>
              )}
              <button className={styles.navLine} onClick={props.onOpenAuthQR}>
                <Icon name="qr_code" size={15} />
                <span className={styles.navLineLabel}>{t("Show auth URL QR code")}</span>
              </button>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

function NavLine(props: { icon: IconName; label: string; value: string; onClick: () => void }) {
  return (
    <button className={styles.navLine} onClick={props.onClick}>
      <Icon name={props.icon} size={15} />
      <span className={styles.navLineLabel}>{props.label}</span>
      <span className={styles.navLineValue}>{props.value}</span>
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
  onShowPeer: (id: string) => void;
  onConnectSSH: (peer: TailscalePeer) => void;
}) {
  const groups = props.endpoint.userGroups
    .map((group) => ({ group, peers: group.peers }))
    .filter((entry) => entry.peers.length > 0);

  return (
    <>
      {groups.map(({ group, peers }) => (
        <div key={group.userID.toString()}>
          <div className="list-section-title">{group.displayName || group.loginName}</div>
          <div className={styles.peerList}>
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
    <div className={styles.peerItem}>
      <button className={styles.peerItemMain} onClick={props.onOpen}>
        <StateDot tone={peer.online ? "good" : undefined} />
        <span className="peer-name">{peerDisplayName(peer)}</span>
        <span className="peer-address">{peer.tailscaleIPs[0] ?? ""}</span>
        {peer.online && (
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
        )}
      </button>
      {props.onConnectSSH && (
        <OthersMenu className={styles.peerMenu} icon="more_horiz">
          <MenuItem icon="terminal" onSelect={props.onConnectSSH}>
            {t("Connect via SSH")}
          </MenuItem>
        </OthersMenu>
      )}
    </div>
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
          {props.endpoint.networkName !== "" && (
            <DetailSection title={t("Network")}>
              <DataLine label={t("Network")} value={props.endpoint.networkName} />
            </DetailSection>
          )}
          {canLogout && (
            <div className="row-actions" style={{ marginTop: 10 }}>
              <Button
                variant="danger"
                size="small"
                onClick={() => {
                  if (confirm(t("Log out from this Tailscale network?"))) {
                    void api.tailscaleLogout(props.endpoint.endpointTag).catch(showError);
                    props.onClose();
                  }
                }}
              >
                <Icon name="logout" size={13} />
                {t("Log out")}
              </Button>
            </div>
          )}
        </>
      )}

      <DetailSection title={t("Addresses")}>
        {peer.dnsName !== "" && (
          <DataLine label="MagicDNS" value={<CopyValue value={peer.dnsName.replace(/\.$/, "")} />} />
        )}
        <DataLine label={t("Hostname")} value={<CopyValue value={peer.hostName} />} />
        {ipv4 && <DataLine label="IPv4" value={<CopyValue value={ipv4} />} />}
        {ipv6 && <DataLine label="IPv6" value={<CopyValue value={ipv6} />} />}
      </DetailSection>

      {!props.isSelf && peer.online && (
        <PingSection endpoint={props.endpoint} peer={peer} />
      )}

      <DetailSection title={t("Details")}>
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
      </DetailSection>
      {sshAvailable && (
        <div className="row-actions" style={{ marginTop: 14 }}>
          {sshRemembered && (
            <Button onClick={props.onEditSSH}>
              <Icon name="edit" size={13} />
              {t("Edit SSH Configuration")}
            </Button>
          )}
          <Button variant="primary" onClick={props.onConnectSSH}>
            <Icon name="terminal" size={13} />
            {t("Connect via SSH")}
          </Button>
        </div>
      )}
    </>
  );
}

function PingSection(props: { endpoint: TailscaleEndpointStatus; peer: TailscalePeer }) {
  const api = useApi();
  const { t } = useI18n();
  const [history, setHistory] = useState<number[]>([]);
  const [latest, setLatest] = useState<TailscalePingResponse | null>(null);
  const { running, error, reportError, start: startAction, stop } = useStreamingAction();

  const start = () =>
    startAction(async (signal) => {
      setHistory([]);
      setLatest(null);
      for await (const response of api.client.startTailscalePing(
        {
          endpointTag: props.endpoint.endpointTag,
          peerIP: props.peer.tailscaleIPs[0] ?? "",
        },
        { signal },
      )) {
        if (response.error !== "") {
          reportError(response.error);
          continue;
        }
        setLatest(response);
        setHistory((current) => {
          const next = current.concat(response.latencyMs);
          return next.length > 30 ? next.slice(next.length - 30) : next;
        });
      }
    });

  return (
    <DetailSection
      title={t("Ping")}
      accessory={
        <IconButton
          title={running ? t("Stop") : t("Start")}
          onClick={() => (running ? stop() : start())}
        >
          <Icon name={running ? "stop" : "play_arrow"} size={13} />
        </IconButton>
      }
    >
      {error !== "" && <div className="hint" style={{ color: "var(--danger)", padding: "9px 0" }}>{error}</div>}
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
          <div style={{ margin: "6px 0 8px" }}>
            <Sparkline
              data={history}
              color={latest.isDirect ? "var(--good)" : "var(--info)"}
              height={56}
            />
          </div>
        </>
      )}
      {running && !latest && error === "" && (
        <div className="hint" style={{ padding: "9px 0" }}>{t("Connecting...")}</div>
      )}
      {!latest && !running && <div className="hint" style={{ padding: "9px 0" }}>{t("No data")}</div>}
    </DetailSection>
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
    void api.setTailscaleExitNode(props.endpoint.endpointTag, stableID).catch(showError);
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
          <StateDot tone={peer.online ? "good" : undefined} />
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
      <h3>{t("SSH Configuration")}</h3>
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
      <div className="hint" style={{ display: "grid", gap: 6 }}>
        <div>
          {t(
            "If enabled, Connect will open the session directly without asking again. This also applies to the shortcut menu on this peer's entry in the peer list.",
          )}
        </div>
        <div>
          {t(
            "This peer will also appear in the New Session menu when connected to other peers via SSH.",
          )}
        </div>
      </div>
      <div className="row-actions dialog-actions">
        <Button onClick={props.onCancel}>
          {t("Cancel")}
        </Button>
        <Button variant="primary" disabled={username.trim() === ""} onClick={connect}>
          {t("Connect")}
        </Button>
      </div>
    </Dialog>
  );
}
