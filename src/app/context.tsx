import { createContext, useContext, useEffect, useRef, useState } from "react";

import type { DaemonApi } from "../api/daemon";

export const ApiContext = createContext<DaemonApi | null>(null);

export function useApi(): DaemonApi {
  const api = useContext(ApiContext);
  if (!api) {
    throw new Error("missing api context");
  }
  return api;
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

type NavigationGuard = (proceed: () => void) => void;

let navigationGuard: NavigationGuard | null = null;

// Registers a guard consulted by navigate(). Returns an unregister that clears
// the guard only if it's still the current one, so a stale cleanup (e.g. a
// StrictMode double-mount) can't clobber a guard registered afterwards.
function registerNavigationGuard(guard: NavigationGuard): () => void {
  navigationGuard = guard;
  return () => {
    if (navigationGuard === guard) {
      navigationGuard = null;
    }
  };
}

export function navigate(path: string) {
  const go = () => {
    location.hash = `#/${path}`;
  };
  if (navigationGuard) {
    navigationGuard(go);
  } else {
    go();
  }
}

// Blocks in-app navigation (and warns on tab close) while `active`, invoking
// `onBlock` with a `proceed` callback that runs the deferred navigation.
export function useNavigationGuard(active: boolean, onBlock: NavigationGuard) {
  const handler = useRef(onBlock);
  handler.current = onBlock;
  useEffect(() => {
    if (!active) {
      return;
    }
    const unregister = registerNavigationGuard((proceed) => handler.current(proceed));
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      unregister();
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [active]);
}

const MOBILE_QUERY = "(max-width: 720px)";

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

export type ThemePreference = "auto" | "light" | "dark";

const THEME_KEY = "sing-box-dashboard.theme";

export function loadThemePreference(): ThemePreference {
  const value = localStorage.getItem(THEME_KEY);
  if (value === "light" || value === "dark") {
    return value;
  }
  return "auto";
}

export function saveThemePreference(preference: ThemePreference) {
  localStorage.setItem(THEME_KEY, preference);
}

export function applyTheme(preference: ThemePreference) {
  const dark =
    preference === "dark" ||
    (preference === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";

  const surface = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim();
  if (surface) {
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.setAttribute("content", surface);
    });
  }

  // iOS 26 Safari ignores theme-color and tints the status bar from the
  // .statusbar-tint probe (see global.css). It only samples a fixed element
  // when a new node enters the render tree: color changes on a registered
  // element go unnoticed, and removals are dropped too (WebKit bug 300965),
  // so display-toggling the same node nets out to nothing. Swap in a fresh
  // clone, and since even that may coalesce into a no-op if WebKit diffs the
  // fixed-element set by shape rather than node identity, also flash a twin
  // probe on top for two frames — the same insert-then-remove sequence as
  // the drawer scrim, which provably re-tints; its dropped removal leaves
  // the new color registered, which is exactly the color we want shown.
  const tint = document.getElementById("statusbar-tint");
  if (tint) {
    const fresh = tint.cloneNode(true) as HTMLElement;
    tint.replaceWith(fresh);
    const flash = fresh.cloneNode(true) as HTMLElement;
    flash.removeAttribute("id");
    document.body.appendChild(flash);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        flash.remove();
      });
    });
  }
}

export const ACCENT_PRESETS = [
  "default",
  "blue",
  "purple",
  "pink",
  "red",
  "orange",
  "yellow",
  "green",
  "graphite",
] as const;

export type AccentPreset = (typeof ACCENT_PRESETS)[number];

export type AccentPreference = AccentPreset | (string & {});

export function isAccentPreset(value: string): value is AccentPreset {
  return (ACCENT_PRESETS as readonly string[]).includes(value);
}

export function normalizeAccentColor(value: string): string | null {
  const hex = value.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(hex)) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
  }
  if (/^[0-9a-f]{6}$/.test(hex)) {
    return `#${hex}`;
  }
  return null;
}

const ACCENT_KEY = "sing-box-dashboard.accent";

export function loadAccentPreference(): AccentPreference {
  const value = localStorage.getItem(ACCENT_KEY);
  if (!value) {
    return "default";
  }
  if (isAccentPreset(value)) {
    return value;
  }
  return normalizeAccentColor(value) ?? "default";
}

export function saveAccentPreference(preference: AccentPreference) {
  if (preference === "default") {
    localStorage.removeItem(ACCENT_KEY);
  } else {
    localStorage.setItem(ACCENT_KEY, preference);
  }
}

export function applyAccent(preference: AccentPreference) {
  const root = document.documentElement;
  if (isAccentPreset(preference)) {
    root.dataset.accent = preference;
    root.style.removeProperty("--custom-accent");
    root.style.removeProperty("--on-accent");
  } else {
    root.dataset.accent = "custom";
    root.style.setProperty("--custom-accent", preference);
    root.style.setProperty("--on-accent", accentTextColor(preference));
  }
}

function accentTextColor(color: string): string {
  const channel = (i: number) => {
    const c = parseInt(color.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  return luminance > 0.45 ? "#1a1a1a" : "#ffffff";
}

export function watchSystemTheme(getPreference: () => ThemePreference): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => applyTheme(getPreference());
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
