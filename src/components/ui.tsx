import { Children, cloneElement, createContext, isValidElement, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type KeyboardEvent, type MouseEventHandler, type PointerEventHandler, type ReactElement, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { encode as encodeQR } from "uqr";

import type { DelayTone } from "../api/format";
import {
  ACCENT_PRESETS,
  isAccentPreset,
  normalizeAccentColor,
  useIsMobile,
  type AccentPreference,
  type AccentPreset,
  type ThemePreference,
} from "../app/context";
import { showError } from "../app/errorStore";
import { useDismiss } from "../app/hooks";
import { useI18n, type MessageKey } from "../app/i18n";
import { useLatestRef } from "../app/useLatest";
import { cx } from "../lib/cx";
import { Icon, type IconName } from "./Icon";

export function Card(props: { icon?: IconName; title?: ReactNode; actions?: ReactNode; wide?: boolean; className?: string; children?: ReactNode }) {
  return (
    <div className={cx("card", props.wide && "wide", props.className)}>
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

export function DataLine(props: { label: ReactNode; value: ReactNode; mono?: boolean }) {
  return (
    <div className="data-line">
      <span className="label">{props.label}</span>
      <span className={props.mono ? "value mono" : "value"}>{props.value}</span>
    </div>
  );
}

export function DetailSection(props: { title?: ReactNode; accessory?: ReactNode; children: ReactNode }) {
  return (
    <>
      {(props.title || props.accessory) && (
        <div
          className="drawer-section"
          style={props.accessory ? { display: "flex", alignItems: "center", gap: 8 } : undefined}
        >
          {props.title}
          {props.accessory && <span style={{ marginInlineStart: "auto" }}>{props.accessory}</span>}
        </div>
      )}
      <div className="detail-card">{props.children}</div>
    </>
  );
}

export type BadgeTone = DelayTone | "danger" | "info" | "accent";

function toneClass<T extends string>(tone: T | undefined): T | false {
  return tone && tone !== "neutral" ? tone : false;
}

export function Badge(props: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={cx("badge", toneClass(props.tone))}>{props.children}</span>;
}

export function StateDot(props: { tone?: DelayTone; className?: string }) {
  return <span className={cx("state-dot", toneClass(props.tone), props.className)} />;
}

export function Spinner(props: { className?: string }) {
  return <span className={cx("spinner", props.className)} />;
}

export function Brand(props: { className?: string; product?: string | null }) {
  const product = props.product === undefined ? "dashboard" : props.product;
  return (
    <div className={cx("setup-brand", props.className)}>
      sing-box
      {product !== null && <small>{product}</small>}
    </div>
  );
}

export function Button(props: {
  children?: ReactNode;
  variant?: "primary" | "danger";
  size?: "small";
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  title?: string;
  href?: string;
  target?: string;
  rel?: string;
  "aria-label"?: string;
  "aria-expanded"?: boolean;
  onClick?: MouseEventHandler;
  style?: CSSProperties;
}) {
  const className = cx("button", props.variant, props.size, props.className);
  if (props.href !== undefined) {
    return (
      <a
        className={className}
        href={props.href}
        target={props.target}
        rel={props.rel}
        title={props.title}
        aria-label={props["aria-label"]}
        style={props.style}
        onClick={props.onClick}
      >
        {props.children}
      </a>
    );
  }
  return (
    <button
      className={className}
      type={props.type ?? "button"}
      disabled={props.disabled}
      title={props.title}
      aria-label={props["aria-label"]}
      aria-expanded={props["aria-expanded"]}
      style={props.style}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export function IconButton({
  active,
  danger,
  className,
  ...rest
}: { active?: boolean; danger?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={cx("icon-button", active && "active", danger && "danger", className)}
    />
  );
}

export function EmptyState(props: { icon?: IconName; className?: string; children: ReactNode }) {
  return (
    <div className={cx("empty-state", props.className)}>
      {props.icon && <Icon name={props.icon} size={28} />}
      {props.children}
    </div>
  );
}

const LONG_PRESS_DELAY = 500;
const LONG_PRESS_MOVE_LIMIT = 10;
const CONTEXT_MENU_MARGIN = 8;

export function useContextMenu(menu: ReactNode) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<{ timer: number; x: number; y: number } | null>(null);
  const openedByPressRef = useRef(false);
  useDismiss(menuRef, point !== null, () => setPoint(null));
  useLayoutEffect(() => {
    if (point === null || !menuRef.current) {
      return;
    }
    const rect = menuRef.current.getBoundingClientRect();
    const left = clampToViewport(point.x, rect.width, window.innerWidth);
    const top = clampToViewport(point.y, rect.height, window.innerHeight);
    if (left !== point.x || top !== point.y) {
      setPoint({ x: left, y: top });
    }
  }, [point]);
  const cancelLongPress = () => {
    if (pressRef.current !== null) {
      window.clearTimeout(pressRef.current.timer);
      pressRef.current = null;
    }
  };
  useEffect(
    () => () => {
      if (pressRef.current !== null) {
        window.clearTimeout(pressRef.current.timer);
      }
    },
    [],
  );
  const onContextMenu: MouseEventHandler<HTMLElement> = (event) => {
    event.preventDefault();
    cancelLongPress();
    setPoint({ x: event.clientX, y: event.clientY });
  };
  const onPointerDown: PointerEventHandler<HTMLElement> = (event) => {
    openedByPressRef.current = false;
    cancelLongPress();
    if (event.pointerType === "mouse") {
      return;
    }
    const x = event.clientX;
    const y = event.clientY;
    pressRef.current = {
      x,
      y,
      timer: window.setTimeout(() => {
        pressRef.current = null;
        openedByPressRef.current = true;
        setPoint({ x, y });
      }, LONG_PRESS_DELAY),
    };
  };
  const onPointerMove: PointerEventHandler<HTMLElement> = (event) => {
    const press = pressRef.current;
    if (
      press !== null &&
      (Math.abs(event.clientX - press.x) > LONG_PRESS_MOVE_LIMIT ||
        Math.abs(event.clientY - press.y) > LONG_PRESS_MOVE_LIMIT)
    ) {
      cancelLongPress();
    }
  };
  const onClickCapture: MouseEventHandler<HTMLElement> = (event) => {
    if (openedByPressRef.current) {
      openedByPressRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const triggerProps = {
    onContextMenu,
    onPointerDown,
    onPointerMove,
    onPointerUp: cancelLongPress,
    onPointerCancel: cancelLongPress,
    onClickCapture,
  };
  const element =
    point !== null
      ? createPortal(
          <div
            ref={menuRef}
            className="menu context-menu"
            role="menu"
            style={{ left: point.x, top: point.y }}
            onClick={() => setPoint(null)}
            onKeyUp={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                setPoint(null);
              }
            }}
          >
            {menu}
          </div>,
          document.body,
        )
      : null;
  return { triggerProps, element };
}

function clampToViewport(position: number, size: number, viewport: number) {
  return Math.max(CONTEXT_MENU_MARGIN, Math.min(position, viewport - size - CONTEXT_MENU_MARGIN));
}

export function NavRow(props: {
  icon?: IconName;
  title: string;
  detail?: ReactNode;
  onClick?: () => void;
  href?: string;
  contextMenu?: ReactNode;
}) {
  const contextMenu = useContextMenu(props.contextMenu);
  const triggerProps = props.contextMenu != null ? contextMenu.triggerProps : undefined;
  const menu = contextMenu.element;
  const inner = (
    <>
      {props.icon && <Icon name={props.icon} size={15} />}
      <span>{props.title}</span>
      {props.detail != null && <span className="nav-row-detail">{props.detail}</span>}
      <Icon name={props.href ? "open_in_new" : "keyboard_arrow_right"} size={14} />
    </>
  );
  if (props.href) {
    return (
      <>
        <a
          className="nav-row"
          href={props.href}
          target="_blank"
          rel="noreferrer"
          {...triggerProps}
        >
          {inner}
        </a>
        {menu}
      </>
    );
  }
  return (
    <>
      <button type="button" className="nav-row" onClick={props.onClick} {...triggerProps}>
        {inner}
      </button>
      {menu}
    </>
  );
}

export function NavLines(props: { children: ReactNode }) {
  return <div className="nav-lines">{props.children}</div>;
}

export function NavLine(props: {
  icon: IconName;
  label: ReactNode;
  value?: ReactNode;
  chevron?: boolean;
  onClick?: () => void;
  href?: string;
}) {
  const inner = (
    <>
      <Icon name={props.icon} size={15} />
      <span className="nav-line-label">{props.label}</span>
      {props.value != null && <span className="nav-line-value">{props.value}</span>}
      {props.chevron === true && <Icon name="keyboard_arrow_right" size={14} />}
    </>
  );
  if (props.href != null) {
    return (
      <a className="nav-line" href={props.href} target="_blank" rel="noreferrer">
        {inner}
      </a>
    );
  }
  if (props.onClick != null) {
    return (
      <button type="button" className="nav-line" onClick={props.onClick}>
        {inner}
      </button>
    );
  }
  return <div className="nav-line static">{inner}</div>;
}

export function MenuLink(props: { href: string; children: ReactNode }) {
  return (
    <a className="menu-item" href={props.href} target="_blank" rel="noreferrer">
      <span className="menu-check" />
      {props.children}
    </a>
  );
}

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
          aria-label={option.title}
          className={props.theme === option.value ? "active" : ""}
          onClick={() => props.onChange(option.value)}
        >
          <Icon name={option.icon} size={15} />
        </button>
      ))}
    </div>
  );
}

const ACCENT_TITLES: Record<AccentPreset, MessageKey> = {
  default: "Default",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  graphite: "Graphite",
};

function AccentSelect(props: {
  accent: AccentPreference;
  onChange: (accent: AccentPreference) => void;
}) {
  const { t } = useI18n();
  const custom = isAccentPreset(props.accent) ? null : props.accent;
  const wellValue =
    custom ??
    (getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#1a1a1a");
  return (
    <div className="accent-picker">
      {ACCENT_PRESETS.map((preset) => (
        <button
          key={preset}
          type="button"
          title={t(ACCENT_TITLES[preset])}
          aria-label={t(ACCENT_TITLES[preset])}
          aria-pressed={props.accent === preset}
          className={props.accent === preset ? "active" : ""}
          data-accent={preset}
          onClick={() => props.onChange(preset)}
        />
      ))}
      <label className={custom !== null ? "custom active" : "custom"} title={t("Custom color")}>
        <input
          type="color"
          value={wellValue}
          aria-label={t("Custom color")}
          onChange={(event) =>
            props.onChange(normalizeAccentColor(event.target.value) ?? event.target.value)
          }
        />
      </label>
    </div>
  );
}

export function ThemeMenu(props: {
  accent: AccentPreference;
  onChange: (accent: AccentPreference) => void;
  openUp?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  return (
    <div className="menu-anchor" ref={ref}>
      <Button aria-expanded={open} onClick={() => setOpen(!open)}>
        {isAccentPreset(props.accent) ? (
          <>
            <span className="accent-dot" data-accent={props.accent} />
            {t(ACCENT_TITLES[props.accent])}
          </>
        ) : (
          <>
            <span className="accent-dot" style={{ background: props.accent }} />
            {props.accent.toUpperCase()}
          </>
        )}
        <Icon name="unfold_more" size={13} />
      </Button>
      {open && (
        <div className={props.openUp ? "menu open-up align-right accent-menu" : "menu align-right accent-menu"}>
          <AccentSelect
            accent={props.accent}
            onChange={(accent) => {
              props.onChange(accent);
              if (isAccentPreset(accent)) {
                setOpen(false);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

export function Select<T extends string | number>(props: {
  id?: string;
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  inline?: boolean;
  placeholder?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  useMenuPopover(ref, listRef, open, () => setOpen(false), {
    width: props.inline ? "min-anchor" : "anchor",
  });

  const selected = props.options.find((option) => option.value === props.value);

  const select = (value: T) => {
    setOpen(false);
    if (value !== props.value) {
      props.onChange(value);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) {
      return;
    }
    event.preventDefault();
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    );
    if (items.length === 0) {
      return;
    }
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      current === -1
        ? event.key === "ArrowDown"
          ? 0
          : items.length - 1
        : current + (event.key === "ArrowDown" ? 1 : -1);
    items[(next + items.length) % items.length]?.focus();
  };

  return (
    <div
      className={props.inline ? "menu-anchor select-anchor inline" : "menu-anchor select-anchor"}
      ref={ref}
      onKeyDown={onKeyDown}
    >
      <button
        id={props.id}
        type="button"
        className={props.inline ? "select inline" : "select"}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={props.disabled}
        onClick={() => setOpen(!open)}
      >
        <span className={selected ? "select-value" : "select-value select-placeholder"}>
          {selected ? selected.label : props.placeholder}
        </span>
      </button>
      {open && (
        <div
          popover="manual"
          className={
            props.inline
              ? "menu popover-menu select-menu grow"
              : "menu popover-menu select-menu"
          }
          role="listbox"
          ref={listRef}
        >
          {props.options.map((option) => (
            <button
              key={String(option.value)}
              type="button"
              role="option"
              aria-selected={option.value === props.value}
              className="menu-item"
              onClick={() => select(option.value)}
            >
              <span className="menu-check">
                {option.value === props.value && <Icon name="check" size={13} />}
              </span>
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
            <button type="button" key={option.value} tabIndex={-1}>
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {fits ? (
        <div className="segmented full">
          {props.options.map((option) => (
            <button
              type="button"
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
        <Select options={props.options} value={props.value} onChange={props.onChange} />
      )}
    </div>
  );
}

function useMenuPopover(
  anchorRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLDivElement | null>,
  open: boolean,
  onDismiss: () => void,
  options?: { alignEnd?: boolean; width?: "anchor" | "min-anchor" },
) {
  const alignEnd = options?.alignEnd === true;
  const width = options?.width;
  const dismissRef = useLatestRef(onDismiss);
  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !menuRef.current) {
      return;
    }
    const menu = menuRef.current;
    const anchorRect = anchorRef.current.getBoundingClientRect();
    if (width === "anchor") {
      menu.style.width = `${anchorRect.width}px`;
      menu.style.minWidth = `${anchorRect.width}px`;
    } else if (width === "min-anchor") {
      menu.style.minWidth = `${anchorRect.width}px`;
    }
    menu.showPopover();
    const menuRect = menu.getBoundingClientRect();
    const rightToLeft = getComputedStyle(anchorRef.current).direction === "rtl";
    const alignRightEdge = alignEnd !== rightToLeft;
    let left = alignRightEdge ? anchorRect.right - menuRect.width : anchorRect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - menuRect.width - 8));
    let top = anchorRect.bottom + 6;
    if (top + menuRect.height > window.innerHeight - 8 && anchorRect.top - menuRect.height - 6 >= 8) {
      top = anchorRect.top - menuRect.height - 6;
    }
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    const onScroll = (event: Event) => {
      const target = event.target;
      // A sibling scroll area (such as the live log view) does not move the anchor.
      // Only dismiss when the anchor itself, or one of its ancestors, has scrolled.
      if (
        !(target instanceof Node) ||
        (!menu.contains(target) && target.contains(anchorRef.current))
      ) {
        dismissRef.current();
      }
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [open, anchorRef, menuRef, alignEnd, width, dismissRef]);
}

export function OthersMenu(props: {
  children: ReactNode;
  icon?: IconName;
  title?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  useMenuPopover(ref, menuRef, open, () => setOpen(false), { alignEnd: true });

  return (
    <div className={cx("menu-anchor", props.className)} ref={ref}>
      <IconButton active={open} title={props.title ?? t("Others")} onClick={() => setOpen(!open)}>
        <Icon name={props.icon ?? "more_vert"} />
      </IconButton>
      {open && (
        <div
          ref={menuRef}
          popover="manual"
          className="menu popover-menu"
          role="menu"
          onClick={() => setOpen(false)}
          onKeyUp={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              setOpen(false);
            }
          }}
        >
          <SubMenuGroup>{props.children}</SubMenuGroup>
        </div>
      )}
    </div>
  );
}

const SubMenuGroupContext = createContext<{
  openId: string | null;
  setOpenId: (id: string | null) => void;
} | null>(null);

function SubMenuGroup(props: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const value = useMemo(() => ({ openId, setOpenId }), [openId]);
  return (
    <SubMenuGroupContext.Provider value={value}>
      {props.children}
    </SubMenuGroupContext.Provider>
  );
}

export function MenuLabel(props: { children: ReactNode }) {
  return <div className="menu-label">{props.children}</div>;
}

export function SubMenu(props: { label: ReactNode; icon?: IconName; children: ReactNode }) {
  const id = useId();
  const group = useContext(SubMenuGroupContext);
  const [localOpen, setLocalOpen] = useState(false);
  const open = group ? group.openId === id : localOpen;
  const setOpen = (next: boolean) => {
    if (!group) {
      setLocalOpen(() => next);
    } else if (next) {
      group.setOpenId(id);
    } else if (group.openId === id) {
      group.setOpenId(null);
    }
  };
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
        type="button"
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
      type="button"
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

export function Switch(props: { value: boolean; onChange: (value: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      className={props.value ? "switch on" : "switch"}
      role="switch"
      aria-checked={props.value}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.value)}
    />
  );
}

export function Toggle(props: { label: ReactNode; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <div className="toggle-line">
      <span>{props.label}</span>
      <Switch
        label={typeof props.label === "string" ? props.label : undefined}
        value={props.value}
        onChange={props.onChange}
        disabled={props.disabled}
      />
    </div>
  );
}

export function Field(props: { label: ReactNode; children: ReactElement<{ id?: string }> }) {
  const generatedId = useId();
  const controlId = props.children.props.id ?? generatedId;
  return (
    <div className="field">
      <label className="field-label" htmlFor={controlId}>
        {props.label}
      </label>
      {cloneElement(props.children, { id: controlId })}
    </div>
  );
}

export function SearchInput(props: { value: string; onChange: (value: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="search-input">
      <Icon name="search" size={14} />
      <input
        className="input"
        placeholder={t("Search")}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </div>
  );
}

export function SecretInput(props: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  return (
    <div className="secret-input">
      <input
        id={props.id}
        className="input"
        type={visible ? "text" : "password"}
        autoComplete="new-password"
        value={props.value}
        placeholder={props.placeholder}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <IconButton
        title={visible ? t("Hide secret") : t("Show secret")}
        disabled={props.disabled}
        onClick={() => setVisible(!visible)}
      >
        <Icon name={visible ? "visibility_off" : "visibility"} size={14} />
      </IconButton>
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

let openDialogCount = 0;
let openDrawerCount = 0;

function syncScrimAttribute() {
  if (openDialogCount > 0) {
    document.documentElement.dataset.scrim = "";
  } else if (openDrawerCount > 0) {
    document.documentElement.dataset.scrim = "drawer";
  } else {
    delete document.documentElement.dataset.scrim;
  }
}

function useShowModal(kind: "dialog" | "drawer", focusSelf = false) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }
    dialog.showModal();
    if (kind === "drawer") {
      openDrawerCount += 1;
    } else {
      openDialogCount += 1;
    }
    syncScrimAttribute();
    if (focusSelf) {
      dialog.focus();
    }
    return () => {
      dialog.close();
      if (kind === "drawer") {
        openDrawerCount -= 1;
      } else {
        openDialogCount -= 1;
      }
      syncScrimAttribute();
    };
  }, [kind, focusSelf]);
  return ref;
}

function closeOnBackdropPointerDown(
  event: React.PointerEvent<HTMLDialogElement>,
  onClose: () => void,
) {
  if (event.target !== event.currentTarget) {
    return;
  }
  const rect = event.currentTarget.getBoundingClientRect();
  const inside =
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom;
  if (!inside) {
    onClose();
  }
}

function Drawer(props: { onClose: () => void; ariaLabel: string; children: ReactNode }) {
  const ref = useShowModal("drawer", true);
  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-label={props.ariaLabel}
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
      onPointerDown={(event) => closeOnBackdropPointerDown(event, props.onClose)}
    >
      {props.children}
    </dialog>
  );
}

function reactNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(reactNodeText).join("").trim();
  }
  return isValidElement<{ children?: ReactNode }>(node) ? reactNodeText(node.props.children) : "";
}

export function Dialog(props: { onClose: () => void; className?: string; children: ReactNode }) {
  const ref = useShowModal("dialog");
  let accessibleName = "Dialog";
  for (const child of Children.toArray(props.children)) {
    if (
      isValidElement<{ children?: ReactNode }>(child) &&
      typeof child.type === "string" &&
      /^h[1-6]$/.test(child.type)
    ) {
      const label = reactNodeText(child.props.children);
      if (label !== "") {
        accessibleName = label;
        break;
      }
    }
  }
  return (
    <dialog
      ref={ref}
      className={props.className ? `dialog ${props.className}` : "dialog"}
      aria-label={accessibleName}
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
      onPointerDown={(event) => closeOnBackdropPointerDown(event, props.onClose)}
    >
      {props.children}
    </dialog>
  );
}

export function DetailShell(props: {
  backLabel: string;
  title: ReactNode;
  accessory?: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <div className="page">
        <div className="page-header">
          <button type="button" className="back-button" aria-label={props.backLabel} onClick={props.onClose}>
            <Icon name="arrow_back" size={20} />
          </button>
          <h1 className="page-title">{props.title}</h1>
          {props.accessory && <div className="actions">{props.accessory}</div>}
        </div>
        {props.subtitle}
        {props.children}
      </div>
    );
  }
  return (
    <Drawer
      onClose={props.onClose}
      ariaLabel={typeof props.title === "string" ? props.title : props.backLabel}
    >
      <h3>
        {props.title}
        {props.accessory && <span style={{ marginInlineStart: "auto" }}>{props.accessory}</span>}
      </h3>
      {props.subtitle}
      {props.children}
    </Drawer>
  );
}

export function CopyValue(props: { value: string; className?: string }) {
  const { t } = useI18n();
  return (
    <span className={cx("copy-value", props.className)}>
      <span>{props.value}</span>
      <IconButton
        title={t("Copy")}
        onClick={() => {
          void navigator.clipboard.writeText(props.value).catch(showError);
        }}
      >
        <Icon name="content_copy" size={13} />
      </IconButton>
    </span>
  );
}
