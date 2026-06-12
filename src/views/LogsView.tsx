import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { useStream } from "../api/stream";
import { useApi } from "../app/context";
import { showError } from "../app/errorStore";
import { useI18n, type MessageKey } from "../app/i18n";
import { Icon } from "../components/Icon";
import { StreamBanner } from "../components/StreamBanner";
import { EmptyState, MenuItem, OthersMenu, SearchInput, Spinner, SubMenu } from "../components/ui";
import { LogLevel, ServiceStatus_Type } from "../gen/daemon/started_service_pb";
import { ansiColorCss, parseAnsi, parseCssColor, stripAnsi, type Rgb } from "../lib/ansi";

const MAX_VISIBLE_LOGS = 1000;

const LEVEL_OPTIONS: { value: LogLevel; label: MessageKey }[] = [
  { value: LogLevel.ERROR, label: "Error" },
  { value: LogLevel.WARN, label: "Warn" },
  { value: LogLevel.INFO, label: "Info" },
  { value: LogLevel.DEBUG, label: "Debug" },
  { value: LogLevel.TRACE, label: "Trace" },
];

// The contrast adjustment needs the actual log background; re-resolve it
// whenever the theme attribute flips.
function useLogBackground(): Rgb {
  const [background, setBackground] = useState<Rgb>(() => resolveBackground());
  useEffect(() => {
    const observer = new MutationObserver(() => setBackground(resolveBackground()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return background;
}

function resolveBackground(): Rgb {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--card");
  return parseCssColor(value) ?? [255, 255, 255];
}

// Mirrors the macOS client's "logs-yyyy-MM-dd-HH:mm:ss.txt" naming, with dots
// instead of colons since colons are invalid in filenames on most systems.
function fileTimestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
}

export function LogsView() {
  const api = useApi();
  const { t } = useI18n();
  const logs = useStream(api.logs);
  const serviceStatus = useStream(api.serviceStatus);
  const [level, setLevel] = useState<LogLevel | null>(null);
  const [paused, setPaused] = useState(false);
  const [search, setSearch] = useState("");
  const viewRef = useRef<HTMLDivElement>(null);
  const background = useLogBackground();

  const started = serviceStatus.data.status?.status === ServiceStatus_Type.STARTED;
  const effectiveLevel = level ?? logs.data.defaultLevel ?? LogLevel.INFO;

  const filtered = useMemo(() => {
    let entries = logs.data.entries.filter((entry) => entry.level <= effectiveLevel);
    const query = search.trim().toLowerCase();
    if (query !== "") {
      entries = entries.filter((entry) => stripAnsi(entry.message).toLowerCase().includes(query));
    }
    return entries;
  }, [logs.data.entries, effectiveLevel, search]);

  const visible = useMemo(
    () =>
      filtered.length > MAX_VISIBLE_LOGS
        ? filtered.slice(filtered.length - MAX_VISIBLE_LOGS)
        : filtered,
    [filtered],
  );

  // Exports follow the macOS client: the level/search-filtered logs as plain
  // text (ANSI escapes are useless outside the terminal-styled view).
  const logsText = () => filtered.map((entry) => stripAnsi(entry.message)).join("\n");
  const logFileName = () => `logs-${fileTimestamp()}.txt`;
  const canShare = typeof navigator.share === "function";

  const copyLogs = () => {
    void navigator.clipboard.writeText(logsText()).catch(showError);
  };

  const saveLogs = () => {
    const url = URL.createObjectURL(new Blob([logsText()], { type: "text/plain" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = logFileName();
    anchor.click();
    URL.revokeObjectURL(url);
  };

  // Dismissing the share sheet rejects with AbortError; that is not a failure.
  const onShareError = (error: unknown) => {
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }
    showError(error);
  };

  const shareLogs = () => {
    const text = logsText();
    const file = new File([text], logFileName(), { type: "text/plain" });
    if (navigator.canShare?.({ files: [file] })) {
      void navigator.share({ files: [file] }).catch(onShareError);
    } else {
      void navigator.share({ text }).catch(onShareError);
    }
  };

  useEffect(() => {
    if (paused) {
      return;
    }
    const view = viewRef.current;
    if (view) {
      view.scrollTop = view.scrollHeight;
    }
  }, [visible, paused]);

  let body: ReactNode;
  if (logs.data.entries.length > 0 && logs.phase !== "error") {
    body = (
      <div className="log-view" ref={viewRef}>
        {visible.map((entry) => (
          <LogLine
            key={entry.id}
            message={entry.message}
            highlight={search.trim()}
            background={background}
          />
        ))}
      </div>
    );
  } else if (logs.phase === "error") {
    body = null;
  } else if (!started && serviceStatus.phase === "active") {
    body = <EmptyState icon="text_snippet">{t("Service not started")}</EmptyState>;
  } else if (logs.phase === "connecting") {
    body = (
      <EmptyState>
        <Spinner />
      </EmptyState>
    );
  } else {
    body = <EmptyState icon="text_snippet">{t("Empty logs")}</EmptyState>;
  }

  return (
    <div className="page page-full">
      <div className="page-header">
        <h1 className="page-title">{t("Logs")}</h1>
        <div className="actions">
          <button
            className={paused ? "icon-button active" : "icon-button"}
            title={paused ? t("Resume scrolling") : t("Pause scrolling")}
            onClick={() => setPaused(!paused)}
          >
            <Icon name={paused ? "play_arrow" : "pause"} />
          </button>
          <OthersMenu>
            <SubMenu label={t("Log Level")} icon="filter_list">
              <MenuItem checked={level === null} onSelect={() => setLevel(null)}>
                {t("Default")}
              </MenuItem>
              {LEVEL_OPTIONS.map((option) => (
                <MenuItem
                  key={option.value}
                  checked={level === option.value}
                  onSelect={() => setLevel(option.value)}
                >
                  {t(option.label)}
                </MenuItem>
              ))}
            </SubMenu>
            <SubMenu label={t("Save")} icon="save">
              <MenuItem icon="content_copy" onSelect={copyLogs}>
                {t("To Clipboard")}
              </MenuItem>
              <MenuItem icon="save" onSelect={saveLogs}>
                {t("To File")}
              </MenuItem>
              {canShare && (
                <MenuItem icon="share" onSelect={shareLogs}>
                  {t("Share")}
                </MenuItem>
              )}
            </SubMenu>
            <div className="menu-divider" />
            <MenuItem
              danger
              icon="delete"
              onSelect={() => {
                void api.clearLogs().catch(showError);
              }}
            >
              {t("Clear Logs")}
            </MenuItem>
          </OthersMenu>
        </div>
      </div>
      <div className="field">
        <SearchInput value={search} onChange={setSearch} />
      </div>
      <StreamBanner snapshot={logs} subject="logs" />
      {body}
    </div>
  );
}

const LogLine = memo(function LogLine(props: {
  message: string;
  highlight: string;
  background: Rgb;
}) {
  const segments = parseAnsi(props.message);
  const query = props.highlight.toLowerCase();

  // Highlight ranges are computed over the plain text, then mapped back onto
  // the styled segments so search keeps the ANSI colors (as the macOS client
  // does with its attributed-string highlight).
  const ranges: [number, number][] = [];
  if (query !== "") {
    const plain = segments.map((segment) => segment.text).join("");
    const lower = plain.toLowerCase();
    let index = lower.indexOf(query);
    while (index !== -1) {
      ranges.push([index, index + query.length]);
      index = lower.indexOf(query, index + query.length);
    }
  }

  const parts: ReactNode[] = [];
  let offset = 0;
  let key = 0;
  for (const segment of segments) {
    const start = offset;
    const end = offset + segment.text.length;
    offset = end;

    let style: CSSProperties | undefined;
    if (segment.style) {
      style = {};
      if (segment.style.color) {
        style.color = ansiColorCss(segment.style.color, props.background);
      }
      if (segment.style.bold) {
        style.fontWeight = 700;
      }
      if (segment.style.italic) {
        style.fontStyle = "italic";
      }
      if (segment.style.underline) {
        style.textDecoration = "underline";
      }
    }

    const overlapping = ranges.filter(([from, to]) => to > start && from < end);
    let content: ReactNode;
    if (overlapping.length === 0) {
      content = segment.text;
    } else {
      const pieces: ReactNode[] = [];
      let cursor = 0;
      for (const [from, to] of overlapping) {
        const localFrom = Math.max(0, from - start);
        const localTo = Math.min(segment.text.length, to - start);
        if (localFrom > cursor) {
          pieces.push(segment.text.slice(cursor, localFrom));
        }
        pieces.push(<mark key={key++}>{segment.text.slice(localFrom, localTo)}</mark>);
        cursor = localTo;
      }
      if (cursor < segment.text.length) {
        pieces.push(segment.text.slice(cursor));
      }
      content = pieces;
    }

    if (style) {
      parts.push(
        <span key={key++} style={style}>
          {content}
        </span>,
      );
    } else {
      parts.push(<span key={key++}>{content}</span>);
    }
  }

  return <span className="log-line">{parts}</span>;
});
