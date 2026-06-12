import { useState } from "react";

import {
  createServerId,
  normalizeServerUrl,
  removeServer,
  serverDisplayName,
  upsertServer,
  type Server,
  type ServersState,
} from "../api/config";
import { navigate, type AccentPreference, type ThemePreference } from "../app/context";
import { LanguageSelect, useI18n } from "../app/i18n";
import { Icon } from "../components/Icon";
import { Dialog, Field, ThemeMenu, ThemeSelect } from "../components/ui";

export function SettingsView(props: {
  serversState: ServersState;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  accent: AccentPreference;
  onAccentChange: (accent: AccentPreference) => void;
}) {
  const { t } = useI18n();
  const { servers, activeId } = props.serversState;
  const active = servers.find((server) => server.id === activeId) ?? servers[0];

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{t("Settings")}</h1>
      </div>
      <div className="settings-section">
        <h2 className="settings-section-title">{t("Servers")}</h2>
        <button className="settings-server-link" onClick={() => navigate("settings/servers")}>
          <span className="settings-server-link-icon">
            <Icon name="dns" size={17} />
          </span>
          <span className="settings-server-link-text">
            <span className="server-row-name">{active ? serverDisplayName(active) : ""}</span>
            <span className="server-row-url">{active?.url}</span>
          </span>
          {servers.length > 1 && (
            <span className="settings-server-link-count">{servers.length}</span>
          )}
          <span className="settings-row-chevron">
            <Icon name="keyboard_arrow_right" size={14} />
          </span>
        </button>
      </div>
      <div className="settings-section">
        <h2 className="settings-section-title">{t("Preferences")}</h2>
        <div className="settings-row">
          <span className="settings-row-label">{t("Appearance")}</span>
          <ThemeSelect theme={props.theme} onChange={props.onThemeChange} />
        </div>
        <div className="settings-row">
          <span className="settings-row-label">{t("Theme")}</span>
          <ThemeMenu accent={props.accent} onChange={props.onAccentChange} />
        </div>
        <div className="settings-row">
          <span className="settings-row-label">{t("Language")}</span>
          <LanguageSelect className="select inline" />
        </div>
      </div>
    </div>
  );
}

// Settings → Servers sub-page: pure management — rows open the edit
// dialog; switching the active server stays with the sidebar picker.
export function ServersView(props: {
  serversState: ServersState;
  onServersChange: (state: ServersState) => void;
}) {
  const { t } = useI18n();
  const { servers } = props.serversState;
  const [editing, setEditing] = useState<Server | "new" | null>(null);

  const saveServer = (server: Server) => {
    props.onServersChange(upsertServer(props.serversState, server));
    setEditing(null);
  };

  const deleteServer = (id: string) => {
    props.onServersChange(removeServer(props.serversState, id));
    setEditing(null);
  };

  return (
    <div className="page">
      <div className="page-header">
        <button className="back-button" onClick={() => navigate("settings")}>
          <Icon name="arrow_back" size={15} />
          {t("Settings")}
        </button>
        <h1 className="page-title">{t("Servers")}</h1>
      </div>
      <div className="server-list">
        <button className="server-item-add" onClick={() => setEditing("new")}>
          <span className="server-item-icon">
            <Icon name="add" size={15} />
          </span>
          {t("Add server")}
        </button>
        {servers.map((server) => (
          <button className="server-item" key={server.id} onClick={() => setEditing(server)}>
            <span className="server-item-text">
              <span className="server-row-name">{serverDisplayName(server)}</span>
              <span className="server-row-url">{server.url}</span>
            </span>
            <span className="settings-row-chevron">
              <Icon name="keyboard_arrow_right" size={14} />
            </span>
          </button>
        ))}
      </div>
      {editing !== null && (
        <ServerDialog
          server={editing === "new" ? null : editing}
          canDelete={editing !== "new" && servers.length > 0}
          onSave={saveServer}
          onDelete={deleteServer}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

export function ServerDialog(props: {
  server: Server | null;
  canDelete: boolean;
  onSave: (server: Server) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(props.server?.name ?? "");
  const [url, setUrl] = useState(props.server?.url ?? "");
  const [secret, setSecret] = useState(props.server?.secret ?? "");

  const normalizedUrl = normalizeServerUrl(url);
  const valid = normalizedUrl !== "";

  return (
    <Dialog onClose={props.onClose}>
      <h3>{props.server ? t("Edit Server") : t("New Server")}</h3>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) {
            return;
          }
          props.onSave({
            id: props.server?.id ?? createServerId(),
            name: name.trim(),
            url: normalizedUrl,
            secret,
          });
        }}
      >
        <Field label={t("Name")}>
          <input
            className="input"
            value={name}
            placeholder={t("Optional")}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label={t("URL")}>
          <input
            className="input"
            value={url}
            placeholder={t("Required")}
            autoFocus={!props.server}
            onChange={(event) => setUrl(event.target.value)}
          />
        </Field>
        <Field label={t("Secret")}>
          <input
            className="input"
            value={secret}
            placeholder={t("Optional")}
            autoComplete="off"
            onChange={(event) => setSecret(event.target.value)}
          />
        </Field>
        <div className="row-actions dialog-actions">
          {props.server && props.canDelete && (
            <button
              className="button danger"
              type="button"
              style={{ marginInlineEnd: "auto" }}
              onClick={() => props.onDelete(props.server!.id)}
            >
              {t("Delete")}
            </button>
          )}
          <button className="button" type="button" onClick={props.onClose}>
            {t("Cancel")}
          </button>
          <button className="button primary" type="submit" disabled={!valid}>
            {t("Save")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
