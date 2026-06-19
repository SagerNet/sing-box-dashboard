import { useState } from "react";

import { removeServer, serverDisplayName, upsertServer, type Server, type ServersState } from "../api/config";
import { useDiagnosedConnectError } from "../app/connectError";
import { useI18n } from "../app/i18n";
import { Icon } from "../components/Icon";
import { Brand, Button, Spinner } from "../components/ui";
import { ServerDialog } from "./SettingsView";
import styles from "./ConnectionErrorView.module.css";

export function ConnectionErrorView(props: {
  server: Server;
  error: string;
  reconnecting: boolean;
  onRetry: () => void;
  serversState: ServersState;
  onServersChange: (state: ServersState) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const errorDetail = useDiagnosedConnectError(props.error, props.server.url);
  const { servers } = props.serversState;
  const others = servers.filter((server) => server.id !== props.server.id);

  const saveServer = (server: Server) => {
    props.onServersChange(upsertServer(props.serversState, server));
    setEditing(false);
  };

  const deleteServer = (id: string) => {
    props.onServersChange(removeServer(props.serversState, id));
    setEditing(false);
  };

  return (
    <div className="setup">
      <div className="setup-panel">
        <Brand />
        <div className={styles.connectionErrorHeader}>
          <span className={styles.connectionErrorIcon}>
            <Icon name="cloud_off" size={22} />
          </span>
          <div>
            <h1>{t("Connection failed")}</h1>
            <div className={styles.connectionErrorServer}>
              {serverDisplayName(props.server)}
              <span className={styles.connectionErrorUrl}>{props.server.url}</span>
            </div>
          </div>
        </div>
        <div className="banner error">
          <Icon name="warning_amber" />
          <div>{errorDetail}</div>
        </div>
        <div className="row-actions" style={{ marginTop: 14 }}>
          <Button variant="primary" disabled={props.reconnecting} onClick={props.onRetry}>
            {props.reconnecting && <Spinner />}
            {props.reconnecting ? t("Reconnecting...") : t("Retry")}
          </Button>
          <Button onClick={() => setEditing(true)}>
            {t("Edit Server")}
          </Button>
        </div>
        {others.length > 0 && (
          <div className={styles.connectionErrorSwitch}>
            <div className={styles.connectionErrorSwitchTitle}>{t("Switch to another server")}</div>
            {others.map((server) => (
              <button
                key={server.id}
                className={styles.connectionErrorSwitchItem}
                onClick={() => props.onServersChange({ servers, activeId: server.id })}
              >
                <Icon name="dns" size={14} />
                <span className="server-row-name">{serverDisplayName(server)}</span>
                <span className="server-row-url">{server.url}</span>
                <span className="settings-row-chevron">
                  <Icon name="keyboard_arrow_right" size={14} />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {editing && (
        <ServerDialog
          server={props.server}
          canDelete={true}
          onSave={saveServer}
          onDelete={deleteServer}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
