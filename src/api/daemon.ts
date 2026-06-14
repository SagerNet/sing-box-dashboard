import type { Client, Interceptor, Transport } from "@connectrpc/connect";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createGrpcWebTransport } from "@connectrpc/connect-web";

import { MIN_API_VERSION } from "../app/capabilities";
import {
  Connection,
  ConnectionEventType,
  DeprecatedWarning,
  Group,
  GroupItem,
  LogLevel,
  ServiceStatus,
  StartedService,
  Status,
  TailscaleEndpointStatus,
  USBIPServerStatus,
} from "../gen/daemon/started_service_pb";
import { serverConnectUrl, type Server } from "./config";
import { StreamStore } from "./stream";

export const STATUS_HISTORY_LENGTH = 30;
const LOG_MAX_ENTRIES = 3000;
const CLOSED_CONNECTIONS_MAX = 1000;

export interface ServiceStatusData {
  status: ServiceStatus | null;
}

export interface StatusData {
  current: Status | null;
  uplinkHistory: number[];
  downlinkHistory: number[];
}

export interface GroupsData {
  groups: Group[];
  loaded: boolean;
}

export interface ClashModeData {
  modeList: string[];
  currentMode: string;
  loaded: boolean;
}

export interface LogEntry {
  id: number;
  level: LogLevel;
  message: string;
}

export interface LogsData {
  entries: LogEntry[];
  defaultLevel: LogLevel | null;
}

export interface ConnectionRow {
  connection: Connection;
  uplinkRate: number;
  downlinkRate: number;
  uplinkTotal: bigint;
  downlinkTotal: bigint;
  closedAt: number | null;
}

export interface ConnectionsData {
  rows: Map<string, ConnectionRow>;
  loaded: boolean;
}

export interface OutboundsData {
  outbounds: GroupItem[];
  loaded: boolean;
}

export interface TailscaleData {
  endpoints: TailscaleEndpointStatus[];
  loaded: boolean;
}

export interface UsbipData {
  servers: USBIPServerStatus[];
  loaded: boolean;
}

export interface ServerInfo {
  version: string;
  apiVersion: number;
}

function authInterceptor(secret: string): Interceptor {
  return (next) => (request) => {
    request.header.set("Authorization", `Bearer ${secret}`);
    return next(request);
  };
}

const SUBSCRIPTION_INTERVAL = 1_000_000_000n;

export class DaemonApi {
  readonly config: Server;
  readonly client: Client<typeof StartedService>;

  readonly serviceStatus: StreamStore<ServiceStatusData>;
  readonly status: StreamStore<StatusData>;
  readonly groups: StreamStore<GroupsData>;
  readonly clashMode: StreamStore<ClashModeData>;
  readonly logs: StreamStore<LogsData>;
  readonly connections: StreamStore<ConnectionsData>;
  readonly outbounds: StreamStore<OutboundsData>;
  readonly tailscale: StreamStore<TailscaleData>;
  readonly usbip: StreamStore<UsbipData>;

  private logSequence = 0;
  private versionCache: ServerInfo | null = null;

  constructor(config: Server, transport?: Transport) {
    this.config = config;
    this.client = createClient(
      StartedService,
      transport ??
        createGrpcWebTransport({
          baseUrl: serverConnectUrl(config.url),
          interceptors: config.secret ? [authInterceptor(config.secret)] : [],
        }),
    );

    this.serviceStatus = new StreamStore<ServiceStatusData>(
      () => ({ status: null }),
      async ({ signal, update }) => {
        for await (const message of this.client.subscribeServiceStatus({}, { signal })) {
          update((data) => ({ ...data, status: message }));
        }
      },
    );

    this.status = new StreamStore<StatusData>(
      () => ({ current: null, uplinkHistory: [], downlinkHistory: [] }),
      async ({ signal, update }) => {
        for await (const message of this.client.subscribeStatus(
          { interval: SUBSCRIPTION_INTERVAL },
          { signal },
        )) {
          update((data) => ({
            current: message,
            uplinkHistory: appendHistory(data.uplinkHistory, Number(message.uplink)),
            downlinkHistory: appendHistory(data.downlinkHistory, Number(message.downlink)),
          }));
        }
      },
    );

    this.groups = new StreamStore<GroupsData>(
      () => ({ groups: [], loaded: false }),
      async ({ signal, update }) => {
        for await (const message of this.client.subscribeGroups({}, { signal })) {
          update(() => ({ groups: message.group, loaded: true }));
        }
      },
    );

    this.clashMode = new StreamStore<ClashModeData>(
      () => ({ modeList: [], currentMode: "", loaded: false }),
      async ({ signal, update }) => {
        const initial = await this.client.getClashModeStatus({}, { signal });
        update(() => ({
          modeList: initial.modeList,
          currentMode: initial.currentMode,
          loaded: true,
        }));
        for await (const message of this.client.subscribeClashMode({}, { signal })) {
          update((data) => ({ ...data, currentMode: message.mode }));
        }
      },
    );

    this.logs = new StreamStore<LogsData>(
      () => ({ entries: [], defaultLevel: null }),
      async ({ signal, update }) => {
        const defaultLevel = await this.client.getDefaultLogLevel({}, { signal });
        update((data) => ({ ...data, defaultLevel: defaultLevel.level }));
        for await (const message of this.client.subscribeLog({}, { signal })) {
          update((data) => {
            let entries = message.reset ? [] : data.entries;
            const appended = message.messages.map((logMessage) => ({
              id: this.logSequence++,
              level: logMessage.level,
              message: logMessage.message,
            }));
            entries = entries.concat(appended);
            if (entries.length > LOG_MAX_ENTRIES) {
              entries = entries.slice(entries.length - LOG_MAX_ENTRIES);
            }
            return { ...data, entries };
          });
        }
      },
    );

    this.connections = new StreamStore<ConnectionsData>(
      () => ({ rows: new Map(), loaded: false }),
      async ({ signal, update }) => {
        for await (const message of this.client.subscribeConnections(
          { interval: SUBSCRIPTION_INTERVAL },
          { signal },
        )) {
          update((data) => {
            const rows = message.reset ? new Map<string, ConnectionRow>() : new Map(data.rows);
            for (const event of message.events) {
              switch (event.type) {
                case ConnectionEventType.CONNECTION_EVENT_NEW: {
                  if (!event.connection) {
                    break;
                  }
                  rows.set(event.id, {
                    connection: event.connection,
                    uplinkRate: 0,
                    downlinkRate: 0,
                    uplinkTotal: event.connection.uplinkTotal,
                    downlinkTotal: event.connection.downlinkTotal,
                    closedAt:
                      event.connection.closedAt > 0n ? Number(event.connection.closedAt) : null,
                  });
                  break;
                }
                case ConnectionEventType.CONNECTION_EVENT_UPDATE: {
                  const row = rows.get(event.id);
                  if (!row) {
                    break;
                  }
                  rows.set(event.id, {
                    ...row,
                    uplinkRate: Number(event.uplinkDelta),
                    downlinkRate: Number(event.downlinkDelta),
                    uplinkTotal: row.uplinkTotal + event.uplinkDelta,
                    downlinkTotal: row.downlinkTotal + event.downlinkDelta,
                  });
                  break;
                }
                case ConnectionEventType.CONNECTION_EVENT_CLOSED: {
                  const row = rows.get(event.id);
                  const closedAt = event.closedAt > 0n ? Number(event.closedAt) : Date.now();
                  if (event.connection) {
                    rows.set(event.id, {
                      connection: event.connection,
                      uplinkRate: 0,
                      downlinkRate: 0,
                      uplinkTotal: event.connection.uplinkTotal,
                      downlinkTotal: event.connection.downlinkTotal,
                      closedAt,
                    });
                  } else if (row) {
                    rows.set(event.id, {
                      ...row,
                      uplinkRate: 0,
                      downlinkRate: 0,
                      closedAt,
                    });
                  }
                  break;
                }
              }
            }
            pruneClosedRows(rows);
            return { rows, loaded: true };
          });
        }
      },
      true,
    );

    this.outbounds = new StreamStore<OutboundsData>(
      () => ({ outbounds: [], loaded: false }),
      async ({ signal, update }) => {
        for await (const message of this.client.subscribeOutbounds({}, { signal })) {
          update(() => ({ outbounds: message.outbounds, loaded: true }));
        }
      },
    );

    this.tailscale = new StreamStore<TailscaleData>(
      () => ({ endpoints: [], loaded: false }),
      async ({ signal, update }) => {
        for await (const message of this.client.subscribeTailscaleStatus({}, { signal })) {
          update(() => ({ endpoints: message.endpoints, loaded: true }));
        }
      },
    );

    this.usbip = new StreamStore<UsbipData>(
      () => ({ servers: [], loaded: false }),
      async ({ signal, update }) => {
        await this.requireApiVersion(MIN_API_VERSION.usbip);
        for await (const message of this.client.subscribeUSBIPServerStatus({}, { signal })) {
          update(() => ({ servers: message.servers, loaded: true }));
        }
      },
    );
  }

  retryNow(): void {
    this.serviceStatus.retryNow();
    this.status.retryNow();
    this.groups.retryNow();
    this.clashMode.retryNow();
    this.logs.retryNow();
    this.connections.retryNow();
    this.outbounds.retryNow();
    this.tailscale.retryNow();
    this.usbip.retryNow();
  }

  async urlTest(groupTag: string): Promise<void> {
    await this.client.uRLTest({ outboundTag: groupTag });
  }

  async selectOutbound(groupTag: string, outboundTag: string): Promise<void> {
    await this.client.selectOutbound({ groupTag, outboundTag });
  }

  async setGroupExpand(groupTag: string, isExpand: boolean): Promise<void> {
    await this.client.setGroupExpand({ groupTag, isExpand });
  }

  async setClashMode(mode: string): Promise<void> {
    await this.client.setClashMode({ mode });
  }

  async closeConnection(id: string): Promise<void> {
    await this.client.closeConnection({ id });
  }

  async closeAllConnections(): Promise<void> {
    await this.client.closeAllConnections({});
  }

  async clearLogs(): Promise<void> {
    await this.client.clearLogs({});
  }

  async serverInfo(): Promise<ServerInfo> {
    if (!this.versionCache) {
      const response = await this.client.getVersion({});
      this.versionCache = { version: response.version, apiVersion: response.apiVersion };
    }
    return this.versionCache;
  }

  private async requireApiVersion(min: number): Promise<void> {
    const { apiVersion } = await this.serverInfo();
    if (apiVersion < min) {
      throw new ConnectError(`requires server API version ${min}`, Code.Unimplemented);
    }
  }

  async getStartedAt(): Promise<number> {
    const response = await this.client.getStartedAt({});
    return Number(response.startedAt);
  }

  async getDeprecatedWarnings(): Promise<DeprecatedWarning[]> {
    const response = await this.client.getDeprecatedWarnings({});
    return response.warnings;
  }

  async setTailscaleExitNode(endpointTag: string, stableID: string): Promise<void> {
    await this.client.setTailscaleExitNode({ endpointTag, stableID });
  }

  async tailscaleLogout(endpointTag: string): Promise<void> {
    await this.client.tailscaleLogout({ endpointTag });
  }
}

function appendHistory(history: number[], value: number): number[] {
  const next = history.concat(value);
  if (next.length > STATUS_HISTORY_LENGTH) {
    return next.slice(next.length - STATUS_HISTORY_LENGTH);
  }
  return next;
}

function pruneClosedRows(rows: Map<string, ConnectionRow>) {
  let closedCount = 0;
  for (const row of rows.values()) {
    if (row.closedAt !== null) {
      closedCount += 1;
    }
  }
  if (closedCount <= CLOSED_CONNECTIONS_MAX) {
    return;
  }
  const closedRows: { id: string; closedAt: number }[] = [];
  for (const [id, row] of rows) {
    if (row.closedAt !== null) {
      closedRows.push({ id, closedAt: row.closedAt });
    }
  }
  closedRows.sort((left, right) => left.closedAt - right.closedAt);
  for (let i = 0; i < closedRows.length - CLOSED_CONNECTIONS_MAX; i++) {
    rows.delete(closedRows[i].id);
  }
}
