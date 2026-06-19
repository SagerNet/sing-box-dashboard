import { useState, type ReactNode } from "react";

import {
  formatBitrate,
  natFilteringDescription,
  natFilteringTone,
  natMappingDescription,
  natMappingTone,
  proxyDisplayType,
} from "../api/format";
import { useStream } from "../api/stream";
import { useSupportsCapability } from "../app/capabilities";
import { navigate, useApi } from "../app/context";
import { useStreamingAction } from "../app/hooks";
import { useI18n } from "../app/i18n";
import { Icon } from "../components/Icon";
import { Badge, Button, Card, DataLine, Dialog, Field, NavRow, Select, Spinner, Toggle } from "../components/ui";
import {
  ServiceStatus_Type,
  type NetworkQualityTestProgress,
  type STUNTestProgress,
} from "../gen/daemon/started_service_pb";

const NETWORK_QUALITY_DEFAULT_URL = "https://mensura.cdn-apple.com/api/v1/gm/config";
const STUN_DEFAULT_SERVER = "stun.voipgate.com:3478";

export function ToolsView() {
  const api = useApi();
  const { t } = useI18n();
  const serviceStatus = useStream(api.serviceStatus);
  const started = serviceStatus.data.status?.status === ServiceStatus_Type.STARTED;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{t("Tools")}</h1>
      </div>
      <div className="settings-stack">
        {started && <TailscaleEndpointRows />}
        {started && <UsbipServerRows />}
        <div>
          <div className="list-section-title">{t("Network")}</div>
          <div className="nav-list">
            <NavRow
              icon="network_check"
              title={t("Network Quality")}
              onClick={() => navigate("tools/network-quality")}
            />
            <NavRow icon="swap_horiz" title={t("STUN Test")} onClick={() => navigate("tools/stun")} />
          </div>
        </div>
      </div>
    </div>
  );
}

function TailscaleEndpointRows() {
  const api = useApi();
  const { t } = useI18n();
  const tailscale = useStream(api.tailscale);
  const endpoints = tailscale.data.endpoints;
  if (!tailscale.data.loaded || endpoints.length === 0) {
    return null;
  }
  return (
    <div>
      <div className="list-section-title">{t("Endpoints")}</div>
      <div className="nav-list">
        {endpoints.map((endpoint) => (
          <NavRow
            key={endpoint.endpointTag}
            icon="hub"
            title={
              endpoints.length > 1 && endpoint.endpointTag !== ""
                ? t("Tailscale: {tag}", { tag: endpoint.endpointTag })
                : "Tailscale"
            }
            onClick={() => navigate(`tools/tailscale/${encodeURIComponent(endpoint.endpointTag)}`)}
          />
        ))}
      </div>
    </div>
  );
}

function UsbipServerRows() {
  const api = useApi();
  const { t } = useI18n();
  const usbip = useStream(api.usbip);
  const supported = useSupportsCapability("usbip");
  const servers = usbip.data.servers;
  if (!supported || !usbip.data.loaded || servers.length === 0) {
    return null;
  }
  return (
    <div>
      <div className="list-section-title">{t("Services")}</div>
      <div className="nav-list">
        {servers.map((server) => (
          <NavRow
            key={server.serverTag}
            icon="usb"
            title={
              servers.length > 1 && server.serverTag !== ""
                ? t("USB/IP: {tag}", { tag: server.serverTag })
                : "USB/IP"
            }
            onClick={() => navigate(`tools/usbip/${encodeURIComponent(server.serverTag)}`)}
          />
        ))}
      </div>
    </div>
  );
}

export function ToolsPageHeader(props: { title: string; actions?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="page-header">
      <button className="back-button" aria-label={t("Tools")} onClick={() => navigate("tools")}>
        <Icon name="arrow_back" size={20} />
      </button>
      <h1 className="page-title">{props.title}</h1>
      {props.actions && <div className="actions">{props.actions}</div>}
    </div>
  );
}

function OutboundPicker(props: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const api = useApi();
  const { t } = useI18n();
  const outbounds = useStream(api.outbounds);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const query = search.trim().toLowerCase();
  const filtered = outbounds.data.outbounds.filter(
    (outbound) =>
      query === "" ||
      outbound.tag.toLowerCase().includes(query) ||
      proxyDisplayType(outbound.type).toLowerCase().includes(query),
  );

  const select = (value: string) => {
    setOpen(false);
    if (value !== props.value) {
      props.onChange(value);
    }
  };

  return (
    <Field label={t("Outbound")}>
      <button
        type="button"
        className="select"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={props.disabled}
        onClick={() => {
          setSearch("");
          setOpen(true);
        }}
      >
        <span className="select-value">{props.value === "" ? t("Default") : props.value}</span>
      </button>
      {open && (
        <Dialog onClose={() => setOpen(false)}>
          <h3>{t("Outbound")}</h3>
          <Field label={t("Search")}>
            <input
              className="input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              autoFocus
            />
          </Field>
          <button className="peer-row" onClick={() => select("")}>
            <span className="peer-name">{t("Default")}</span>
            {props.value === "" && (
              <span className="badges">
                <Icon name="check" size={14} />
              </span>
            )}
          </button>
          {filtered.map((outbound) => (
            <button className="peer-row" key={outbound.tag} onClick={() => select(outbound.tag)}>
              <span className="peer-name">{outbound.tag}</span>
              <span className="peer-address">
                {proxyDisplayType(outbound.type)}
                {outbound.urlTestDelay > 0 ? ` · ${outbound.urlTestDelay}ms` : ""}
              </span>
              {props.value === outbound.tag && (
                <span className="badges">
                  <Icon name="check" size={14} />
                </span>
              )}
            </button>
          ))}
        </Dialog>
      )}
    </Field>
  );
}

function AccuracyBadge(props: { accuracy: number }) {
  const { t } = useI18n();
  switch (props.accuracy) {
    case 2:
      return <Badge tone="good">{t("High")}</Badge>;
    case 1:
      return <Badge tone="medium">{t("Medium")}</Badge>;
    default:
      return <Badge tone="bad">{t("Low")}</Badge>;
  }
}

export function NetworkQualityView() {
  const api = useApi();
  const { t } = useI18n();
  const [configURL, setConfigURL] = useState(NETWORK_QUALITY_DEFAULT_URL);
  const [outboundTag, setOutboundTag] = useState("");
  const [serial, setSerial] = useState(false);
  const [http3, setHttp3] = useState(false);
  const [maxRuntime, setMaxRuntime] = useState(20);
  const [progress, setProgress] = useState<NetworkQualityTestProgress | null>(null);
  const { running, error, reportError, start: startAction, stop } = useStreamingAction();

  const start = () =>
    startAction(async (signal) => {
      setProgress(null);
      for await (const update of api.client.startNetworkQualityTest(
        {
          configURL,
          outboundTag,
          serial,
          http3,
          maxRuntimeSeconds: maxRuntime,
        },
        { signal },
      )) {
        setProgress(update);
        if (update.error !== "") {
          reportError(update.error);
        }
      }
    });

  const finished = progress?.isFinal ?? false;
  const phase = progress?.phase ?? 0;

  return (
    <div className="page">
      <ToolsPageHeader title={t("Network Quality")} />
      <div className="settings-stack">
        <Card>
          <Field label={t("Configuration URL")}>
            <input
              className="input"
              value={configURL}
              onChange={(event) => setConfigURL(event.target.value)}
              disabled={running}
            />
          </Field>
          <OutboundPicker value={outboundTag} onChange={setOutboundTag} disabled={running} />
          <Field label={t("Max runtime")}>
            <Select
              options={[20, 30, 60].map((count) => ({
                value: count,
                label: t("{count} seconds", { count }),
              }))}
              value={maxRuntime}
              onChange={setMaxRuntime}
              disabled={running}
            />
          </Field>
          <Toggle label={t("Serial")} value={serial} onChange={setSerial} disabled={running} />
          <Toggle label="HTTP/3" value={http3} onChange={setHttp3} disabled={running} />
          <div className="row-actions" style={{ marginTop: 10 }}>
            {running ? (
              <Button variant="danger" onClick={stop}>
                <Icon name="stop" size={13} />
                {t("Cancel test")}
              </Button>
            ) : (
              <Button variant="primary" onClick={start}>
                <Icon name="play_arrow" size={13} />
                {t("Start test")}
              </Button>
            )}
          </div>
        </Card>
        {(running || progress !== null || error !== "") && (
        <Card title={t("Results")}>
          {error !== "" && (
            <div className="banner error" style={{ marginBottom: 10 }}>
              <Icon name="warning_amber" />
              <div>{error}</div>
            </div>
          )}
          {progress && (
            <>
              <DataLine
                label={t("Idle latency")}
                value={progress.idleLatencyMs > 0 ? `${progress.idleLatencyMs} ms` : "-"}
              />
              <DataLine
                label={t("Download")}
                value={
                  <ResultValue
                    pending={running && !finished && phase === 1}
                    value={progress.downloadCapacity > 0n ? formatBitrate(progress.downloadCapacity) : "-"}
                    badge={finished && progress.downloadCapacity > 0n ? <AccuracyBadge accuracy={progress.downloadCapacityAccuracy} /> : null}
                  />
                }
              />
              <DataLine
                label={t("Upload")}
                value={
                  <ResultValue
                    pending={running && !finished && phase === 2}
                    value={progress.uploadCapacity > 0n ? formatBitrate(progress.uploadCapacity) : "-"}
                    badge={finished && progress.uploadCapacity > 0n ? <AccuracyBadge accuracy={progress.uploadCapacityAccuracy} /> : null}
                  />
                }
              />
              <DataLine
                label={t("Download RPM")}
                value={
                  <ResultValue
                    pending={running && !finished && phase === 1}
                    value={progress.downloadRPM > 0 ? String(progress.downloadRPM) : "-"}
                    badge={finished && progress.downloadRPM > 0 ? <AccuracyBadge accuracy={progress.downloadRPMAccuracy} /> : null}
                  />
                }
              />
              <DataLine
                label={t("Upload RPM")}
                value={
                  <ResultValue
                    pending={running && !finished && phase === 2}
                    value={progress.uploadRPM > 0 ? String(progress.uploadRPM) : "-"}
                    badge={finished && progress.uploadRPM > 0 ? <AccuracyBadge accuracy={progress.uploadRPMAccuracy} /> : null}
                  />
                }
              />
              <DataLine
                label={t("Elapsed")}
                value={`${(Number(progress.elapsedMs) / 1000).toFixed(1)}s`}
              />
            </>
          )}
          {!progress && running && (
            <div className="hint" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Spinner /> {t("Fetching configuration...")}
            </div>
          )}
        </Card>
        )}
      </div>
    </div>
  );
}

function ResultValue(props: { pending: boolean; value: string; badge: React.ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      {props.pending && <Spinner />}
      {props.value}
      {props.badge}
    </span>
  );
}

export function STUNTestView() {
  const api = useApi();
  const { t } = useI18n();
  const [server, setServer] = useState(STUN_DEFAULT_SERVER);
  const [outboundTag, setOutboundTag] = useState("");
  const [progress, setProgress] = useState<STUNTestProgress | null>(null);
  const { running, error, reportError, start: startAction, stop } = useStreamingAction();

  const start = () =>
    startAction(async (signal) => {
      setProgress(null);
      for await (const update of api.client.startSTUNTest({ server, outboundTag }, { signal })) {
        setProgress(update);
        if (update.error !== "") {
          reportError(update.error);
        }
      }
    });

  return (
    <div className="page">
      <ToolsPageHeader title={t("STUN Test")} />
      <div className="settings-stack">
        <Card>
          <Field label={t("Server")}>
            <input
              className="input"
              value={server}
              onChange={(event) => setServer(event.target.value)}
              disabled={running}
            />
          </Field>
          <OutboundPicker value={outboundTag} onChange={setOutboundTag} disabled={running} />
          <div className="row-actions" style={{ marginTop: 10 }}>
            {running ? (
              <Button variant="danger" onClick={stop}>
                <Icon name="stop" size={13} />
                {t("Cancel test")}
              </Button>
            ) : (
              <Button variant="primary" onClick={start}>
                <Icon name="play_arrow" size={13} />
                {t("Start test")}
              </Button>
            )}
          </div>
        </Card>
        {(running || progress !== null || error !== "") && (
        <Card title={t("Results")}>
          {error !== "" && (
            <div className="banner error" style={{ marginBottom: 10 }}>
              <Icon name="warning_amber" />
              <div>{error}</div>
            </div>
          )}
          {progress && (
            <>
              <DataLine label={t("External address")} value={progress.externalAddr || "-"} />
              <DataLine
                label={t("Latency")}
                value={progress.latencyMs > 0 ? `${progress.latencyMs} ms` : "-"}
              />
              {progress.isFinal && !progress.natTypeSupported ? (
                <DataLine label={t("NAT type detection")} value={t("Not supported by server")} />
              ) : (
                <>
                  <DataLine
                    label={t("NAT mapping")}
                    value={
                      progress.natMapping > 0 ? (
                        <Badge tone={natMappingTone(progress.natMapping)}>
                          {natMappingDescription(progress.natMapping)}
                        </Badge>
                      ) : running ? (
                        <Spinner />
                      ) : (
                        "-"
                      )
                    }
                  />
                  <DataLine
                    label={t("NAT filtering")}
                    value={
                      progress.natFiltering > 0 ? (
                        <Badge tone={natFilteringTone(progress.natFiltering)}>
                          {natFilteringDescription(progress.natFiltering)}
                        </Badge>
                      ) : running ? (
                        <Spinner />
                      ) : (
                        "-"
                      )
                    }
                  />
                </>
              )}
            </>
          )}
          {!progress && running && (
            <div className="hint" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Spinner /> {t("Binding...")}
            </div>
          )}
        </Card>
        )}
      </div>
    </div>
  );
}
