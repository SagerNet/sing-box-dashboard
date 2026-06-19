import { Code } from "@connectrpc/connect";
import { memo, useMemo, useState } from "react";

import type { ConnectionRow } from "../api/daemon";
import { formatBytes, formatClockTime, formatDateTime, formatDurationMs } from "../api/format";
import { useStream } from "../api/stream";
import { useApi, useIsMobile } from "../app/context";
import { showError } from "../app/errorStore";
import { useI18n, type MessageKey } from "../app/i18n";
import { Icon } from "../components/Icon";
import { StreamStates } from "../components/StreamBanner";
import { Badge, Button, DataLine, DetailSection, DetailShell, MenuItem, MenuLabel, OthersMenu, SearchInput } from "../components/ui";
import styles from "./ConnectionsView.module.css";

type StateFilter = "all" | "active" | "closed";
type SortMode = "date" | "traffic" | "trafficTotal";

const STATE_OPTIONS: { value: StateFilter; label: MessageKey }[] = [
  { value: "active", label: "Active" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

const SORT_OPTIONS: { value: SortMode; label: MessageKey }[] = [
  { value: "date", label: "By date" },
  { value: "traffic", label: "By traffic" },
  { value: "trafficTotal", label: "By traffic total" },
];

export function ConnectionsView() {
  const api = useApi();
  const { t } = useI18n();
  const connections = useStream(api.connections);
  const isMobile = useIsMobile();
  const [stateFilter, setStateFilter] = useState<StateFilter>("active");
  const [sortMode, setSortMode] = useState<SortMode>("date");
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const result: ConnectionRow[] = [];
    for (const row of connections.data.rows.values()) {
      if (stateFilter === "active" && row.closedAt !== null) {
        continue;
      }
      if (stateFilter === "closed" && row.closedAt === null) {
        continue;
      }
      if (!matchesSearch(row, search)) {
        continue;
      }
      result.push(row);
    }
    result.sort((left, right) => {
      switch (sortMode) {
        case "traffic": {
          const leftRate = left.uplinkRate + left.downlinkRate;
          const rightRate = right.uplinkRate + right.downlinkRate;
          if (rightRate !== leftRate) {
            return rightRate - leftRate;
          }
          break;
        }
        case "trafficTotal": {
          const leftTotal = left.uplinkTotal + left.downlinkTotal;
          const rightTotal = right.uplinkTotal + right.downlinkTotal;
          if (rightTotal !== leftTotal) {
            return rightTotal > leftTotal ? 1 : -1;
          }
          break;
        }
        default:
          break;
      }
      const leftCreated = Number(left.connection.createdAt);
      const rightCreated = Number(right.connection.createdAt);
      return rightCreated - leftCreated;
    });
    return result;
  }, [connections.data.rows, stateFilter, sortMode, search]);

  const detailRow = detailId !== null ? (connections.data.rows.get(detailId) ?? null) : null;
  const detailActive = detailRow?.closedAt === null;
  const detail = detailRow && (
    <DetailShell
      backLabel={t("Connections")}
      title={t("Connection")}
      accessory={
        <Badge tone={detailActive ? "good" : "danger"}>
          {detailActive ? t("Active") : t("Closed")}
        </Badge>
      }
      onClose={() => setDetailId(null)}
    >
      <ConnectionDetailBody row={detailRow} onClose={() => setDetailId(null)} />
    </DetailShell>
  );

  if (isMobile && detail) {
    return detail;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{t("Connections")}</h1>
        <div className="actions">
          <OthersMenu>
            <MenuLabel>{t("State")}</MenuLabel>
            {STATE_OPTIONS.map((option) => (
              <MenuItem
                key={option.value}
                checked={stateFilter === option.value}
                onSelect={() => setStateFilter(option.value)}
              >
                {t(option.label)}
              </MenuItem>
            ))}
            <div className="menu-divider" />
            <MenuLabel>{t("Sort By")}</MenuLabel>
            {SORT_OPTIONS.map((option) => (
              <MenuItem
                key={option.value}
                checked={sortMode === option.value}
                onSelect={() => setSortMode(option.value)}
              >
                {t(option.label)}
              </MenuItem>
            ))}
            <div className="menu-divider" />
            <MenuItem
              danger
              icon="close"
              onSelect={() => {
                void api.closeAllConnections().catch(showError);
              }}
            >
              {t("Close All Connections")}
            </MenuItem>
          </OthersMenu>
        </div>
      </div>
      <div className="field">
        <SearchInput value={search} onChange={setSearch} />
      </div>
      <StreamStates
        snapshot={connections}
        subject="connections"
        loaded={connections.data.loaded}
        empty={rows.length === 0}
        emptyIcon="swap_vert"
        emptyMessage={t("Empty connections")}
      />
      {connections.errorCode === Code.Unimplemented && connections.phase === "error" && (
        <div className="hint" style={{ marginBottom: 12 }}>
          {t("Connection tracking requires the Clash API to be configured in the running instance.")}
        </div>
      )}
      {rows.slice(0, 500).map((row) => (
        <ConnectionRowView key={row.connection.id} row={row} onOpen={setDetailId} />
      ))}
      {rows.length > 500 && (
        <div className="hint" style={{ textAlign: "center", padding: 8 }}>
          {t("Showing first {limit} of {count} connections", { limit: 500, count: rows.length })}
        </div>
      )}
      {detail}
    </div>
  );
}

function matchesSearch(row: ConnectionRow, search: string): boolean {
  const query = search.trim();
  if (query === "") {
    return true;
  }
  const connection = row.connection;
  for (const token of query.split(/\s+/)) {
    const separator = token.indexOf(":");
    let matched: boolean;
    if (separator > 0) {
      const key = token.slice(0, separator).toLowerCase();
      const value = token.slice(separator + 1).toLowerCase();
      switch (key) {
        case "network":
          matched = connection.network.toLowerCase() === value;
          break;
        case "inbound":
          matched = connection.inbound.toLowerCase().includes(value);
          break;
        case "inbound.type":
          matched = connection.inboundType.toLowerCase().includes(value);
          break;
        case "source":
          matched = connection.source.toLowerCase().includes(value);
          break;
        case "destination":
          matched = connection.destination.toLowerCase().includes(value);
          break;
        case "outbound":
          matched = connection.outbound.toLowerCase().includes(value);
          break;
        default:
          matched = plainMatch(row, token.toLowerCase());
          break;
      }
    } else {
      matched = plainMatch(row, token.toLowerCase());
    }
    if (!matched) {
      return false;
    }
  }
  return true;
}

function plainMatch(row: ConnectionRow, query: string): boolean {
  const connection = row.connection;
  return (
    connection.destination.toLowerCase().includes(query) ||
    connection.domain.toLowerCase().includes(query) ||
    connection.source.toLowerCase().includes(query) ||
    connection.outbound.toLowerCase().includes(query)
  );
}

function displayDestination(row: ConnectionRow): string {
  if (row.connection.domain !== "") {
    return row.connection.domain;
  }
  return row.connection.destination;
}

const ConnectionRowView = memo(function ConnectionRowView(props: {
  row: ConnectionRow;
  onOpen: (id: string) => void;
}) {
  const { t } = useI18n();
  const row = props.row;
  const connection = row.connection;
  const active = row.closedAt === null;
  const chain = [...connection.chainList].reverse();
  return (
    <button className={styles.connectionRow} onClick={() => props.onOpen(connection.id)}>
      <div className={styles.head}>
        <Badge>{connection.network.toUpperCase()}</Badge>
        <span className={styles.destination}>{displayDestination(row)}</span>
        <span className={styles.spacer} />
        <Badge tone={active ? "good" : "danger"}>{active ? t("Active") : t("Closed")}</Badge>
      </div>
      <div className={styles.columns}>
        {active ? (
          <>
            <div>
              <span>↑ {formatBytes(row.uplinkRate)}/s</span>
              <span>↓ {formatBytes(row.downlinkRate)}/s</span>
            </div>
            <div>
              <span>↑ {formatBytes(row.uplinkTotal)}</span>
              <span>↓ {formatBytes(row.downlinkTotal)}</span>
            </div>
          </>
        ) : (
          <>
            <div>
              <span>↑ {formatBytes(row.uplinkTotal)}</span>
              <span>↓ {formatBytes(row.downlinkTotal)}</span>
            </div>
            <div>
              <span>{formatClockTime(Number(connection.createdAt))}</span>
              <span>{formatDurationMs(row.closedAt! - Number(connection.createdAt))}</span>
            </div>
          </>
        )}
        <div className={styles.right}>
          <span>
            {connection.inboundType}/{connection.inbound}
          </span>
          <span>{active ? (chain[0] ?? connection.outbound) : chain.join(" / ")}</span>
        </div>
      </div>
    </button>
  );
});

function ConnectionDetailBody(props: { row: ConnectionRow; onClose: () => void }) {
  const api = useApi();
  const { t, language } = useI18n();
  const row = props.row;
  const connection = row.connection;
  const active = row.closedAt === null;
  const chain = [...connection.chainList].reverse();
  return (
    <>
      <div className="hint" style={{ fontFamily: "var(--font-mono)" }}>
        {connection.id}
      </div>
      <DetailSection title={t("Traffic")}>
        <Line label={t("Created at")} value={formatDateTime(Number(connection.createdAt), language)} />
        {row.closedAt !== null && (
          <Line label={t("Closed at")} value={formatDateTime(row.closedAt, language)} />
        )}
        <Line label={t("Uplink")} value={formatBytes(row.uplinkTotal)} />
        <Line label={t("Downlink")} value={formatBytes(row.downlinkTotal)} />
      </DetailSection>
      <DetailSection title={t("Metadata")}>
        <Line label={t("Inbound")} value={connection.inbound} />
        <Line label={t("Inbound type")} value={connection.inboundType} />
        <Line label={t("IP version")} value={connection.ipVersion > 0 ? `IPv${connection.ipVersion}` : ""} />
        <Line label={t("Network")} value={connection.network.toUpperCase()} />
        <Line label={t("Source")} value={connection.source} />
        <Line label={t("Destination")} value={connection.destination} />
        <Line label={t("Domain")} value={connection.domain} />
        <Line label={t("Protocol")} value={connection.protocol} />
        <Line label={t("User")} value={connection.user} />
        <Line label={t("From outbound")} value={connection.fromOutbound} />
        <Line label={t("Match rule")} value={connection.rule} />
        <Line label={t("Outbound")} value={connection.outbound} />
        <Line label={t("Outbound type")} value={connection.outboundType} />
        {chain.length > 1 && <Line label={t("Chain")} value={chain.join(" / ")} />}
      </DetailSection>
      {connection.processInfo && (
        <DetailSection title={t("Process")}>
          <Line
            label={t("Process")}
            value={`${connection.processInfo.processPath} (${connection.processInfo.processId})`}
          />
          <Line label={t("User")} value={connection.processInfo.userName} />
        </DetailSection>
      )}
      {active && (
        <>
          <hr className={styles.divider} />
          <div className="row-actions">
            <Button
              variant="danger"
              onClick={() => {
                void api.closeConnection(connection.id).catch(showError);
                props.onClose();
              }}
            >
              <Icon name="close" size={13} />
              {t("Close connection")}
            </Button>
          </div>
        </>
      )}
    </>
  );
}

function Line(props: { label: string; value: string }) {
  if (props.value === "") {
    return null;
  }
  return <DataLine label={props.label} value={props.value} mono />;
}
