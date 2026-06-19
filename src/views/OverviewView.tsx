import { useRef, useState } from "react";

import { formatBytes, formatMemoryBytes } from "../api/format";
import { useStream } from "../api/stream";
import { useApi } from "../app/context";
import { showError } from "../app/errorStore";
import { usePendingValue } from "../app/hooks";
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
import { AdaptiveSegmented, Button, Card, DataLine, Dialog, EmptyState, IconButton, Sparkline } from "../components/ui";
import { ServiceStatus_Type } from "../gen/daemon/started_service_pb";
import styles from "./OverviewView.module.css";
import { cx } from "../lib/cx";

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
            <IconButton
              title={t("Dashboard Items")}
              onClick={() => setManaging(true)}
            >
              <Icon name="tune" />
            </IconButton>
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
  const [currentMode, setPendingMode] = usePendingValue(clashMode.data.currentMode);

  const current = status.data.current;
  const trafficAvailable = current?.trafficAvailable ?? false;
  const modeList = clashMode.data.modeList;

  const renderCard = (card: DashboardCardId) => {
    switch (card) {
      case "uploadTraffic":
        return (
          <Card key={card} icon="upload" title={t("Upload")}>
            <div className={styles.metric}>
              {trafficAvailable ? `${formatBytes(Number(current?.uplink ?? 0))}/s` : "..."}
            </div>
            <div className={styles.metricSub}>
              {trafficAvailable ? formatBytes(Number(current?.uplinkTotal ?? 0)) : "..."}
            </div>
            <Sparkline data={status.data.uplinkHistory} />
          </Card>
        );
      case "downloadTraffic":
        return (
          <Card key={card} icon="download" title={t("Download")}>
            <div className={styles.metric}>
              {trafficAvailable ? `${formatBytes(Number(current?.downlink ?? 0))}/s` : "..."}
            </div>
            <div className={styles.metricSub}>
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
                api.setClashMode(mode).catch((error: unknown) => {
                  setPendingMode(null);
                  showError(error);
                });
              }}
            />
          </Card>
        );
    }
  };

  return <div className={styles.cardGrid}>{orderedEnabledCards(props.config).map(renderCard)}</div>;
}

function CardManagementDialog(props: {
  config: DashboardCardsConfig;
  onChange: (config: DashboardCardsConfig) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const moveDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (dragIndex === null || !listRef.current) {
      return;
    }
    const rows = Array.from(listRef.current.children) as HTMLElement[];
    const target = rows.findIndex((row) => {
      const rect = row.getBoundingClientRect();
      return event.clientY >= rect.top && event.clientY < rect.bottom;
    });
    if (target >= 0 && target !== dragIndex) {
      props.onChange(moveCard(props.config, dragIndex, target));
      setDragIndex(target);
    }
  };

  return (
    <Dialog onClose={props.onClose}>
      <h3>{t("Dashboard Items")}</h3>
      <div className={styles.cardManageList} ref={listRef}>
        {props.config.order.map((card, index) => {
          const enabled = props.config.enabled.includes(card);
          return (
            <div
              key={card}
              className={cx(styles.cardManageRow, dragIndex === index && styles.dragging)}
            >
              <span
                className={styles.dragHandle}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDragIndex(index);
                }}
                onPointerMove={moveDrag}
                onPointerUp={() => setDragIndex(null)}
                onPointerCancel={() => setDragIndex(null)}
              >
                <Icon name="drag_handle" size={14} />
              </span>
              <Icon name={DASHBOARD_CARDS[card].icon} size={15} />
              <span className={styles.cardManageTitle}>{t(DASHBOARD_CARDS[card].title)}</span>
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
      <div className="row-actions dialog-actions">
        <Button
          variant="danger"
          style={{ marginInlineEnd: "auto" }}
          onClick={() => props.onChange(resetDashboardCardsConfig())}
        >
          {t("Reset")}
        </Button>
        <Button variant="primary" onClick={props.onClose}>
          {t("Done")}
        </Button>
      </div>
    </Dialog>
  );
}
