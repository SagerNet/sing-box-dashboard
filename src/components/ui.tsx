import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { encode as encodeQR } from "uqr";

import type { DelayTone } from "../api/format";
import type { ThemePreference } from "../app/context";
import { useI18n } from "../app/i18n";
import { Icon, type IconName } from "./Icon";

export function Card(props: { icon?: IconName; title?: ReactNode; actions?: ReactNode; wide?: boolean; children?: ReactNode }) {
  return (
    <div className={props.wide ? "card wide" : "card"}>
      {(props.title || props.actions) && (
        <div className="card-header">
          {props.icon && <Icon name={props.icon} />}
          <span>{props.title}</span>
          {props.actions && <div className="actions">{props.actions}</div>}
        </div>
      )}
      {props.children}
    </div>
  );
}

export function DataLine(props: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="data-line">
      <span className="label">{props.label}</span>
      <span className="value">{props.value}</span>
    </div>
  );
}

export type BadgeTone = DelayTone | "danger" | "info" | "accent";

export function Badge(props: { tone?: BadgeTone; children: ReactNode }) {
  const tone = props.tone && props.tone !== "neutral" ? ` ${props.tone}` : "";
  return <span className={`badge${tone}`}>{props.children}</span>;
}

export function Spinner() {
  return <span className="spinner" />;
}

export function EmptyState(props: { icon?: IconName; children: ReactNode }) {
  return (
    <div className="empty-state">
      {props.icon && <Icon name={props.icon} size={28} />}
      {props.children}
    </div>
  );
}

export function SegmentedControl(props: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="segmented">
      {props.options.map((option) => (
        <button
          key={option.value}
          className={option.value === props.value ? "active" : ""}
          disabled={props.disabled}
          onClick={() => {
            if (option.value !== props.value) {
              props.onChange(option.value);
            }
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// Shared between Settings preferences and the first-run setup screen.
export function ThemeSelect(props: {
  theme: ThemePreference;
  onChange: (theme: ThemePreference) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="icon-segmented">
      {(
        [
          { value: "auto", icon: "brightness_auto", title: t("System") },
          { value: "light", icon: "light_mode", title: t("Light") },
          { value: "dark", icon: "dark_mode", title: t("Dark") },
        ] as const
      ).map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          className={props.theme === option.value ? "active" : ""}
          onClick={() => props.onChange(option.value)}
        >
          <Icon name={option.icon} size={15} />
        </button>
      ))}
    </div>
  );
}

// Full-width segmented control that falls back to a select when the labels
// no longer fit, mirroring ClashModeCard's tabsFit measurement.
export function AdaptiveSegmented(props: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(true);

  useEffect(() => {
    const update = () => {
      const container = containerRef.current;
      const measure = measureRef.current;
      if (container && measure) {
        setFits(measure.scrollWidth <= container.clientWidth);
      }
    };
    update();
    const observer = new ResizeObserver(update);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, [props.options]);

  return (
    <div ref={containerRef}>
      <div className="segmented-measure" aria-hidden ref={measureRef}>
        <div className="segmented" style={{ height: "auto" }}>
          {props.options.map((option) => (
            <button key={option.value} tabIndex={-1}>
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {fits ? (
        <div className="segmented full">
          {props.options.map((option) => (
            <button
              key={option.value}
              className={option.value === props.value ? "active" : ""}
              onClick={() => {
                if (option.value !== props.value) {
                  props.onChange(option.value);
                }
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : (
        <select
          className="select"
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
        >
          {props.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// "Others" overflow menu, mirroring the ellipsis-circle toolbar menu in
// sing-box-for-apple's LogView/ConnectionListView. Picker groups become
// labelled radio sections; any item click closes the menu.
export function OthersMenu(props: { children: ReactNode; icon?: IconName }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div className="menu-anchor" ref={ref}>
      <button
        className={open ? "icon-button active" : "icon-button"}
        title={t("Others")}
        onClick={() => setOpen(!open)}
      >
        <Icon name={props.icon ?? "more_vert"} />
      </button>
      {open && (
        <div className="menu align-right" onClick={() => setOpen(false)}>
          {props.children}
        </div>
      )}
    </div>
  );
}

export function MenuLabel(props: { children: ReactNode }) {
  return <div className="menu-label">{props.children}</div>;
}

// Nested flyout matching the UIMenu submenus in sing-box-for-apple's LogView
// (Log Level / Save). Opens on hover for mouse, on tap for touch; selecting a
// nested item bubbles up to OthersMenu and closes the whole menu.
export function SubMenu(props: { label: ReactNode; icon?: IconName; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="submenu"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") {
          setOpen(true);
        }
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") {
          setOpen(false);
        }
      }}
    >
      <button
        className="menu-item"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(!open);
        }}
      >
        <span className="menu-check">{props.icon && <Icon name={props.icon} size={13} />}</span>
        {props.label}
        <span className="submenu-arrow">
          <Icon name="keyboard_arrow_right" size={12} />
        </span>
      </button>
      {open && <div className="menu submenu-panel">{props.children}</div>}
    </div>
  );
}

export function MenuItem(props: {
  checked?: boolean;
  icon?: IconName;
  danger?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={props.danger ? "menu-item danger" : "menu-item"}
      onClick={props.onSelect}
    >
      <span className="menu-check">
        {props.checked && <Icon name="check" size={13} />}
        {props.icon && <Icon name={props.icon} size={13} />}
      </span>
      {props.children}
    </button>
  );
}

export function Toggle(props: { label: ReactNode; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <div className="toggle-line">
      <span>{props.label}</span>
      <button
        className={props.value ? "switch on" : "switch"}
        role="switch"
        aria-checked={props.value}
        disabled={props.disabled}
        onClick={() => props.onChange(!props.value)}
      />
    </div>
  );
}

export function Field(props: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label>{props.label}</label>
      {props.children}
    </div>
  );
}

export function Sparkline(props: { data: number[]; height?: number; color?: string; capacity?: number }) {
  const height = props.height ?? 46;
  const width = 300;
  const capacity = props.capacity ?? 30;
  const max = Math.max(...props.data, 1);
  const stepX = width / Math.max(capacity - 1, 1);
  const offset = Math.max(0, capacity - props.data.length);
  const points = props.data.map((value, index) => {
    const x = (offset + index) * stepX;
    const y = height - 3 - (value / (max * 1.2)) * (height - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const color = props.color ?? "var(--accent)";
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ display: "block" }}
    >
      {points.length > 1 && (
        <>
          <polygon
            points={`${points[0].split(",")[0]},${height} ${points.join(" ")} ${points[points.length - 1].split(",")[0]},${height}`}
            fill={color}
            opacity="0.1"
          />
          <polyline
            points={points.join(" ")}
            fill="none"
            stroke={color}
            strokeWidth="1.8"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
    </svg>
  );
}

export function QRCode(props: { value: string }) {
  const qr = useMemo(() => encodeQR(props.value, { border: 2 }), [props.value]);
  const path = useMemo(() => {
    const parts: string[] = [];
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) {
          parts.push(`M${x} ${y}h1v1h-1z`);
        }
      }),
    );
    return parts.join("");
  }, [qr]);
  return (
    <svg className="qr-code" viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={props.value}>
      <path d={path} fill="#000" shapeRendering="crispEdges" />
    </svg>
  );
}

export function Drawer(props: { onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          props.onClose();
        }
      }}
    >
      <div className="drawer">{props.children}</div>
    </div>
  );
}

export function Dialog(props: { onClose: () => void; className?: string; children: ReactNode }) {
  return (
    <div
      className="dialog-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          props.onClose();
        }
      }}
    >
      <div className={props.className ? `dialog ${props.className}` : "dialog"}>{props.children}</div>
    </div>
  );
}

export function CopyValue(props: { value: string }) {
  const { t } = useI18n();
  return (
    <span className="copy-value">
      <span>{props.value}</span>
      <button
        className="icon-button"
        title={t("Copy")}
        onClick={() => {
          void navigator.clipboard.writeText(props.value);
        }}
      >
        <Icon name="content_copy" size={13} />
      </button>
    </span>
  );
}
