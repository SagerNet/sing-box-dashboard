import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

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
import { ReachabilityIndicator, useServerReachability } from "../components/ReachabilityIndicator";
import { Button, Dialog, Field, IconButton, NavRow, Select, Spinner, ThemeMenu, ThemeSelect } from "../components/ui";
import {
  DEFAULT_DARK_THEME_NAME,
  DEFAULT_LIGHT_THEME_NAME,
  loadTerminalConfig,
  saveTerminalConfig,
  type TerminalConfig,
} from "../lib/tailscaleSSH";
import { parseCustomTheme, type Scheme, type TerminalThemeEntry } from "../lib/terminalTheme";
import styles from "./SettingsView.module.css";
import { cx } from "../lib/cx";

export function SettingsView() {
  const { t } = useI18n();

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{t("Settings")}</h1>
      </div>
      <div className="settings-stack">
        <div className="nav-list">
          <NavRow
            icon="tune"
            title={t("Preferences")}
            onClick={() => navigate("settings/preferences")}
          />
          <NavRow
            icon="dns"
            title={t("Servers")}
            onClick={() => navigate("settings/servers")}
          />
        </div>
        <div>
          <div className="list-section-title">{t("About")}</div>
          <div className="nav-list">
            <NavRow
              icon="description"
              title={t("Documentation")}
              href="https://sing-box.sagernet.org"
            />
            <NavRow
              icon="code"
              title={t("Source Code")}
              href="https://github.com/SagerNet/sing-box-dashboard"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsPageHeader(props: {
  title: string;
  action?: ReactNode;
  back?: string;
  backLabel?: string;
}) {
  const { t } = useI18n();
  const back = props.back ?? "settings";
  return (
    <div className="page-header">
      <button
        className="back-button"
        aria-label={props.backLabel ?? t("Settings")}
        onClick={() => navigate(back)}
      >
        <Icon name="arrow_back" size={20} />
      </button>
      <h1 className="page-title">{props.title}</h1>
      {props.action && <div className="actions">{props.action}</div>}
    </div>
  );
}

export function PreferencesView(props: {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  accent: AccentPreference;
  onAccentChange: (accent: AccentPreference) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="page">
      <SettingsPageHeader title={t("Preferences")} />
      <div className="settings-stack">
        <div className={styles.settingsList}>
          <div className="settings-row">
            <Icon name="brightness_auto" size={15} />
            <span className="settings-row-label">{t("Appearance")}</span>
            <ThemeSelect theme={props.theme} onChange={props.onThemeChange} />
          </div>
          <div className="settings-row">
            <Icon name="palette" size={15} />
            <span className="settings-row-label">{t("Theme")}</span>
            <ThemeMenu accent={props.accent} onChange={props.onAccentChange} />
          </div>
          <div className="settings-row">
            <Icon name="language" size={15} />
            <span className="settings-row-label">{t("Language")}</span>
            <LanguageSelect />
          </div>
        </div>
        <div>
          <div className="list-section-title">Tailscale</div>
          <div className="nav-list">
            <NavRow
              icon="terminal"
              title={t("Terminal Configuration")}
              onClick={() => navigate("settings/preferences/terminal")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

const FONT_SIZES = [8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32];

// Common monospace families; the live terminal appends a generic monospace
// fallback, so unavailable choices degrade gracefully.
const FONT_FAMILIES = [
  "Menlo",
  "Monaco",
  "SF Mono",
  "Consolas",
  "Cascadia Code",
  "Fira Code",
  "JetBrains Mono",
  "Source Code Pro",
  "IBM Plex Mono",
  "Roboto Mono",
  "Ubuntu Mono",
  "Courier New",
];

const CUSTOM_THEME_PLACEHOLDER = `{
  "background": "#1e1e1e",
  "foreground": "#d4d4d4",
  "cursor": "#d4d4d4",
  "selectionBackground": "#264f78"
}`;

function ThemeSchemeSection(props: {
  scheme: Scheme;
  name: string;
  custom: string;
  onChange: (patch: Partial<TerminalConfig>) => void;
}) {
  const { t } = useI18n();
  const { scheme, name, custom } = props;
  const isDark = scheme === "dark";
  const isCustom = name === "";
  // Remember the last named theme so toggling "Custom" off restores it.
  const remembered = useRef(name || (isDark ? DEFAULT_DARK_THEME_NAME : DEFAULT_LIGHT_THEME_NAME));
  if (!isCustom) {
    remembered.current = name;
  }
  const invalid = isCustom && custom.trim() !== "" && parseCustomTheme(custom) === null;

  const setName = (value: string) =>
    props.onChange(isDark ? { darkThemeName: value } : { lightThemeName: value });

  return (
    <div>
      <div className="list-section-title">{isDark ? t("Dark") : t("Light")}</div>
      <div className={styles.settingsList}>
        <button
          className="settings-row"
          disabled={isCustom}
          onClick={() => navigate(`settings/preferences/terminal/theme/${scheme}`)}
        >
          <span className="settings-row-label">{t("Theme")}</span>
          <span className="nav-row-detail">{isCustom ? t("Custom theme") : name}</span>
          <span className="settings-row-chevron">
            <Icon name="keyboard_arrow_right" size={14} />
          </span>
        </button>
        <div className="settings-row">
          <span className="settings-row-label">{t("Custom theme")}</span>
          <button
            className={isCustom ? "switch on" : "switch"}
            role="switch"
            aria-checked={isCustom}
            aria-label={t("Custom theme")}
            onClick={() => setName(isCustom ? remembered.current : "")}
          />
        </div>
        {isCustom && (
          <button
            className="settings-row"
            onClick={() => navigate(`settings/preferences/terminal/custom/${scheme}`)}
          >
            <span className="settings-row-label">{t("Edit custom theme")}</span>
            {invalid && <span className={styles.fieldError}>{t("Invalid theme JSON")}</span>}
            <span className="settings-row-chevron">
              <Icon name="keyboard_arrow_right" size={14} />
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

export function TerminalConfigurationView() {
  const { t } = useI18n();
  const [config, setConfig] = useState<TerminalConfig>(loadTerminalConfig);

  const update = (patch: Partial<TerminalConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    saveTerminalConfig(next);
  };

  return (
    <div className="page">
      <SettingsPageHeader
        title={t("Terminal Configuration")}
        back="settings/preferences"
        backLabel={t("Preferences")}
      />
      <div className="settings-stack">
        <ThemeSchemeSection
          scheme="light"
          name={config.lightThemeName}
          custom={config.lightThemeCustom}
          onChange={update}
        />
        <ThemeSchemeSection
          scheme="dark"
          name={config.darkThemeName}
          custom={config.darkThemeCustom}
          onChange={update}
        />
        <div>
          <div className="list-section-title">{t("Font")}</div>
          <div className={styles.settingsList}>
            <div className="settings-row">
              <span className="settings-row-label">{t("Font family")}</span>
              <Select
                inline
                options={[
                  { value: "", label: t("Default") },
                  ...FONT_FAMILIES.map((family) => ({ value: family, label: family })),
                ]}
                value={config.fontFamily}
                onChange={(fontFamily) => update({ fontFamily })}
              />
            </div>
            <div className="settings-row">
              <span className="settings-row-label">{t("Font size")}</span>
              <Select
                inline
                options={FONT_SIZES.map((size) => ({ value: size, label: String(size) }))}
                value={config.fontSize}
                onChange={(fontSize) => update({ fontSize })}
              />
            </div>
          </div>
        </div>
        <div>
          <div className="list-section-title">{t("Symbol Bar")}</div>
          <div className={styles.settingsList}>
            <div className="settings-row">
              <span className="settings-row-label">{t("Always show")}</span>
              <button
                className={config.symbolBarAlwaysShow ? "switch on" : "switch"}
                role="switch"
                aria-checked={config.symbolBarAlwaysShow}
                aria-label={t("Always show")}
                onClick={() => update({ symbolBarAlwaysShow: !config.symbolBarAlwaysShow })}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TerminalThemeEditorView(props: { scheme: Scheme }) {
  const { t } = useI18n();
  const isDark = props.scheme === "dark";
  const [value, setValue] = useState(() => {
    const config = loadTerminalConfig();
    return isDark ? config.darkThemeCustom : config.lightThemeCustom;
  });
  const invalid = value.trim() !== "" && parseCustomTheme(value) === null;

  const change = (next: string) => {
    setValue(next);
    const latest = loadTerminalConfig();
    saveTerminalConfig(
      isDark ? { ...latest, darkThemeCustom: next } : { ...latest, lightThemeCustom: next },
    );
  };

  return (
    <div className="page">
      <SettingsPageHeader
        title={t("Custom theme")}
        back="settings/preferences/terminal"
        backLabel={t("Terminal Configuration")}
      />
      <div className="settings-stack">
        <textarea
          className={cx("input", styles.themeEditor)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={CUSTOM_THEME_PLACEHOLDER}
          value={value}
          onChange={(event) => change(event.target.value)}
        />
        {invalid && <span className={styles.fieldError}>{t("Invalid theme JSON")}</span>}
        <p className={styles.themeEditorNote}>
          {t("Colors use the xterm.js theme format.")}{" "}
          <a
            href="https://xtermjs.org/docs/api/terminal/interfaces/itheme/"
            target="_blank"
            rel="noreferrer"
          >
            {t("Learn more")}
          </a>
        </p>
      </div>
    </div>
  );
}

function ThemePreview({ theme }: { theme: TerminalThemeEntry["theme"] }) {
  const fg = theme.foreground;
  // ANSI slots are absent on the built-in themes; fall back to the foreground.
  const color = (value?: string) => value ?? fg;
  return (
    <span className={styles.themePreview} style={{ background: theme.background, color: fg }}>
      <span className={styles.themePreviewLine}>
        <span style={{ color: color(theme.green) }}>➜</span>{" "}
        <span style={{ color: color(theme.cyan) }}>~/project</span>{" "}
        <span style={{ color: color(theme.blue) }}>git:(</span>
        <span style={{ color: color(theme.red) }}>main</span>
        <span style={{ color: color(theme.blue) }}>)</span>
      </span>
      <span className={styles.themePreviewLine}>
        <span style={{ color: color(theme.yellow) }}>$</span>{" "}
        <span>npm</span> <span style={{ color: color(theme.magenta) }}>run</span>{" "}
        <span style={{ color: color(theme.green) }}>build</span>
      </span>
    </span>
  );
}

export function TerminalThemePickerView(props: { scheme: Scheme }) {
  const { t } = useI18n();
  const current =
    props.scheme === "dark"
      ? loadTerminalConfig().darkThemeName
      : loadTerminalConfig().lightThemeName;
  const [query, setQuery] = useState("");
  const [themes, setThemes] = useState<TerminalThemeEntry[] | null>(null);

  useEffect(() => {
    let active = true;
    void import("../lib/terminalThemes").then((module) => {
      if (active) {
        setThemes(module.themesForScheme(props.scheme === "dark"));
      }
    });
    return () => {
      active = false;
    };
  }, [props.scheme]);

  const filtered = useMemo(() => {
    if (!themes) {
      return [];
    }
    const needle = query.trim().toLowerCase();
    return needle === ""
      ? themes
      : themes.filter((entry) => entry.name.toLowerCase().includes(needle));
  }, [themes, query]);

  const select = (name: string) => {
    const latest = loadTerminalConfig();
    saveTerminalConfig(
      props.scheme === "dark"
        ? { ...latest, darkThemeName: name }
        : { ...latest, lightThemeName: name },
    );
    navigate("settings/preferences/terminal");
  };

  return (
    <div className="page">
      <SettingsPageHeader
        title={props.scheme === "dark" ? t("Dark") : t("Light")}
        back="settings/preferences/terminal"
        backLabel={t("Terminal Configuration")}
      />
      <div className="settings-stack">
        <div className="search-input">
          <Icon name="search" size={14} />
          <input
            className="input"
            placeholder={t("Search themes")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {themes === null ? (
          <div className={styles.themePickerLoading}>
            <Spinner />
          </div>
        ) : (
          <div className={styles.settingsList}>
            {filtered.map((entry) => (
              <button
                key={entry.name}
                className={cx("settings-row", styles.themePickerRow)}
                onClick={() => select(entry.name)}
              >
                <ThemePreview theme={entry.theme} />
                <span className="settings-row-label">{entry.name}</span>
                {entry.name === current && <Icon name="check" size={16} />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

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
      <SettingsPageHeader
        title={t("Servers")}
        action={
          <IconButton
            aria-label={t("Add server")}
            title={t("Add server")}
            onClick={() => setEditing("new")}
          >
            <Icon name="add" size={18} />
          </IconButton>
        }
      />
      <div className="nav-list">
        {servers.map((server) => (
          <button className={styles.serverItem} key={server.id} onClick={() => setEditing(server)}>
            <span className={styles.serverItemText}>
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
  const reachability = useServerReachability(url, secret);

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
        <ReachabilityIndicator reachability={reachability} url={url} />
        <div className="row-actions dialog-actions">
          {props.server && props.canDelete && (
            <Button
              variant="danger"
              style={{ marginInlineEnd: "auto" }}
              onClick={() => props.onDelete(props.server!.id)}
            >
              {t("Delete")}
            </Button>
          )}
          <Button onClick={props.onClose}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" type="submit" disabled={!valid}>
            {t("Save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
