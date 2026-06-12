import { useEffect, useState } from "react";

import { formatBytes, formatDateTime, formatMemoryBytes, formatUptime } from "../api/format";
import { useStream } from "../api/stream";
import { useApi, useNow } from "../app/context";
import { useI18n } from "../app/i18n";
import {
  DASHBOARD_CARDS,
  loadDashboardCardsConfig,
  moveCard,
  orderedEnabledCards,
  resetDashboardCardsConfig,
  saveDashboardCardsConfig,
  toggleCard,
  type DashboardCardId,
  type DashboardCardsConfig,
} from "../app/dashboardCards";
import { Icon } from "../components/Icon";
import { StreamBanner } from "../components/StreamBanner";
import { AdaptiveSegmented, Card, DataLine, Dialog, EmptyState, Sparkline } from "../components/ui";
import { ServiceStatus_Type } from "../gen/daemon/started_service_pb";

export function OverviewView() {
  const api = useApi();
  const { t } = useI18n();
  const serviceStatus = useStream(api.serviceStatus);
  const [cardsConfig, setCardsConfig] = useState<DashboardCardsConfig>(() =>
    loadDashboardCardsConfig(),
  );
  const [managing, setManaging] = useState(false);
  const statusType = serviceStatus.data.status?.status;
  const started = statusType === ServiceStatus_Type.STARTED;

  const updateCardsConfig = (next: DashboardCardsConfig) => {
    saveDashboardCardsConfig(next);
    setCardsConfig(next);
  };

  let stateLabel: string | null = null;
  if (serviceStatus.phase === "active" && !started) {
    switch (statusType) {
      case ServiceStatus_Type.STARTING:
        stateLabel = t("Service starting...");
        break;
      case ServiceStatus_Type.STOPPING:
        stateLabel = t("Service stopping...");
        break;
      case ServiceStatus_Type.FATAL:
        stateLabel = t("Service failed to start");
        break;
      default:
        stateLabel = t("Service not started");
        break;
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{t("Overview")}</h1>
        {started && (
          <div className="actions">
            <HeaderUptime />
            <button
              className="icon-button"
              title={t("Dashboard Items")}
              onClick={() => setManaging(true)}
            >
              <Icon name="tune" />
            </button>
          </div>
        )}
      </div>
      <StreamBanner snapshot={serviceStatus} subject="service status" />
      {stateLabel !== null && <EmptyState icon="dashboard">{stateLabel}</EmptyState>}
      {started && <OverviewCards config={cardsConfig} />}
      {managing && (
        <CardManagementDialog
          config={cardsConfig}
          onChange={updateCardsConfig}
          onClose={() => setManaging(false)}
        />
      )}
    </div>
  );
}

function OverviewCards(props: { config: DashboardCardsConfig }) {
  const api = useApi();
  const { t } = useI18n();
  const status = useStream(api.status);
  const clashMode = useStream(api.clashMode);
  const [pendingMode, setPendingMode] = useState<string | null>(null);

  const current = status.data.current;
  const trafficAvailable = current?.trafficAvailable ?? false;
  const modeList = clashMode.data.modeList;
  const currentMode = pendingMode ?? clashMode.data.currentMode;

  useEffect(() => {
    if (pendingMode !== null && clashMode.data.currentMode === pendingMode) {
      setPendingMode(null);
    }
  }, [pendingMode, clashMode.data.currentMode]);

  const renderCard = (card: DashboardCardId) => {
    switch (card) {
      case "uploadTraffic":
        return (
          <Card key={card} icon="upload" title={t("Upload")}>
            <div className="metric">
              {trafficAvailable ? `${formatBytes(Number(current?.uplink ?? 0))}/s` : "..."}
            </div>
            <div className="metric-sub">
              {trafficAvailable ? formatBytes(Number(current?.uplinkTotal ?? 0)) : "..."}
            </div>
            <Sparkline data={status.data.uplinkHistory} />
          </Card>
        );
      case "downloadTraffic":
        return (
          <Card key={card} icon="download" title={t("Download")}>
            <div className="metric">
              {trafficAvailable ? `${formatBytes(Number(current?.downlink ?? 0))}/s` : "..."}
            </div>
            <div className="metric-sub">
              {trafficAvailable ? formatBytes(Number(current?.downlinkTotal ?? 0)) : "..."}
            </div>
            <Sparkline data={status.data.downlinkHistory} />
          </Card>
        );
      case "status":
        return (
          <Card key={card} icon="bug_report" title={t("Status")}>
            <DataLine label={t("Memory")} value={current ? formatMemoryBytes(current.memory) : "..."} />
            <DataLine label={t("Goroutines")} value={current ? current.goroutines : "..."} />
          </Card>
        );
      case "connections":
        return (
          <Card key={card} icon="cable" title={t("Connections")}>
            <DataLine label={t("Inbound")} value={current ? current.connectionsIn : "..."} />
            <DataLine label={t("Outbound")} value={current ? current.connectionsOut : "..."} />
          </Card>
        );
      case "clashMode":
        if (modeList.length <= 1) {
          return null;
        }
        return (
          <Card key={card} icon="route" title={t("Mode")} wide>
            <AdaptiveSegmented
              options={modeList.map((mode) => ({ value: mode, label: mode }))}
              value={currentMode}
              onChange={(mode) => {
                setPendingMode(mode);
                api.setClashMode(mode).catch(() => setPendingMode(null));
              }}
            />
          </Card>
        );
    }
  };

  return <div className="card-grid">{orderedEnabledCards(props.config).map(renderCard)}</div>;
}

// Own component so the 1 s clock tick re-renders only this element, not the
// page. Mounted only while the service runs, so a restart remounts it and
// refetches the start time.
function HeaderUptime() {
  const api = useApi();
  const { t, language } = useI18n();
  const now = useNow();
  const [startedAt, setStartedAt] = useState<number | null>(null);

  useEffect(() => {
    let stale = false;
    api
      .getStartedAt()
      .then((value) => {
        if (!stale) {
          setStartedAt(value);
        }
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [api]);

  if (startedAt === null) {
    return null;
  }
  return (
    <span className="page-uptime" title={`${t("Uptime")} — ${formatDateTime(startedAt, language)}`}>
      <Icon name="power_settings_new" size={13} />
      {formatUptime(startedAt, now)}
    </span>
  );
}

// Mirrors CardManagementSheet: all cards in their configured order, each with
// a drag handle and a visibility toggle, plus Reset and Done.
function CardManagementDialog(props: {
  config: DashboardCardsConfig;
  onChange: (config: DashboardCardsConfig) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  return (
    <Dialog onClose={props.onClose}>
      <h3>{t("Dashboard Items")}</h3>
      <div className="card-manage-list">
        {props.config.order.map((card, index) => {
          const enabled = props.config.enabled.includes(card);
          return (
            <div
              key={card}
              className={dragIndex === index ? "card-manage-row dragging" : "card-manage-row"}
              draggable
              onDragStart={(event) => {
                setDragIndex(index);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (dragIndex !== null && dragIndex !== index) {
                  props.onChange(moveCard(props.config, dragIndex, index));
                  setDragIndex(index);
                }
              }}
              onDragEnd={() => setDragIndex(null)}
            >
              <span className="drag-handle">
                <Icon name="drag_handle" size={14} />
              </span>
              <Icon name={DASHBOARD_CARDS[card].icon} size={15} />
              <span className="card-manage-title">{t(DASHBOARD_CARDS[card].title)}</span>
              <button
                className={enabled ? "switch on" : "switch"}
                role="switch"
                aria-checked={enabled}
                onClick={() => props.onChange(toggleCard(props.config, card))}
              />
            </div>
          );
        })}
      </div>
      <div className="row-actions" style={{ marginTop: 16 }}>
        <button
          className="button danger"
          style={{ marginInlineEnd: "auto" }}
          onClick={() => props.onChange(resetDashboardCardsConfig())}
        >
          {t("Reset")}
        </button>
        <button className="button primary" onClick={props.onClose}>
          {t("Done")}
        </button>
      </div>
    </Dialog>
  );
}
