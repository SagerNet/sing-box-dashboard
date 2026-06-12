// Formatting mirrors the helpers sing-box graphical clients use
// (libbox FormatBytes / FormatMemoryBytes / FormatBitrate / FormatDuration).


// Scheme check for links received from the daemon (deprecation migration
// links, Tailscale auth URLs): the daemon is trusted, but a compromised
// config must not be able to smuggle javascript: URLs into clickable anchors.
export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

function formatUnits(value: number, base: number): string {
  if (!Number.isFinite(value) || value < 0) {
    value = 0;
  }
  let unitIndex = 0;
  while (value >= base && unitIndex < BYTE_UNITS.length - 1) {
    value /= base;
    unitIndex += 1;
  }
  const rounded = unitIndex === 0 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
  return `${rounded} ${BYTE_UNITS[unitIndex]}`;
}

export function formatBytes(value: number | bigint): string {
  return formatUnits(Number(value), 1000);
}

export function formatMemoryBytes(value: number | bigint): string {
  return formatUnits(Number(value), 1024);
}

export function formatBitrate(bps: number | bigint): string {
  const value = Number(bps);
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)} Gbps`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)} Mbps`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)} kbps`;
  }
  return `${Math.round(value)} bps`;
}

export function formatDurationMs(durationMs: number): string {
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }
  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${Math.round(seconds % 60)}s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatUptime(startedAtMs: number, nowMs: number): string {
  let totalSeconds = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  totalSeconds -= hours * 3600;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${minutes}:${pad(seconds)}`;
}

export function formatClockTime(timestampMs: number): string {
  const date = new Date(timestampMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatDateTime(timestampMs: number, locale?: string): string {
  return new Date(timestampMs).toLocaleString(locale);
}

export function formatRelativeTime(timestampMs: number, nowMs: number, locale?: string): string {
  const deltaSeconds = Math.round((timestampMs - nowMs) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const absSeconds = Math.abs(deltaSeconds);
  if (absSeconds < 60) {
    return formatter.format(deltaSeconds, "second");
  }
  if (absSeconds < 3600) {
    return formatter.format(Math.round(deltaSeconds / 60), "minute");
  }
  if (absSeconds < 86400) {
    return formatter.format(Math.round(deltaSeconds / 3600), "hour");
  }
  return formatter.format(Math.round(deltaSeconds / 86400), "day");
}

// Delay chip thresholds shared with the sing-box graphical clients.
export type DelayTone = "neutral" | "good" | "medium" | "bad";

export function urlTestDelayTone(delay: number): DelayTone {
  if (delay <= 0) {
    return "neutral";
  }
  if (delay < 800) {
    return "good";
  }
  if (delay < 1500) {
    return "medium";
  }
  return "bad";
}

const PROXY_DISPLAY_TYPES: Record<string, string> = {
  direct: "Direct",
  block: "Block",
  dns: "DNS",
  socks: "SOCKS",
  http: "HTTP",
  shadowsocks: "Shadowsocks",
  vmess: "VMess",
  trojan: "Trojan",
  naive: "Naive",
  wireguard: "WireGuard",
  hysteria: "Hysteria",
  tor: "Tor",
  ssh: "SSH",
  shadowtls: "ShadowTLS",
  shadowsocksr: "ShadowsocksR",
  vless: "VLESS",
  tuic: "TUIC",
  hysteria2: "Hysteria2",
  anytls: "AnyTLS",
  tailscale: "Tailscale",
  selector: "Selector",
  urltest: "URLTest",
};

export function proxyDisplayType(type: string): string {
  return PROXY_DISPLAY_TYPES[type] ?? type;
}

export function natMappingDescription(value: number): string {
  switch (value) {
    case 2:
      return "Endpoint Independent";
    case 3:
      return "Address Dependent";
    case 4:
      return "Address and Port Dependent";
    default:
      return "Unknown";
  }
}

export function natFilteringDescription(value: number): string {
  switch (value) {
    case 1:
      return "Endpoint Independent";
    case 2:
      return "Address Dependent";
    case 3:
      return "Address and Port Dependent";
    default:
      return "Unknown";
  }
}

export function natMappingTone(value: number): DelayTone {
  switch (value) {
    case 2:
      return "good";
    case 3:
      return "medium";
    case 4:
      return "bad";
    default:
      return "neutral";
  }
}

export function natFilteringTone(value: number): DelayTone {
  switch (value) {
    case 1:
      return "good";
    case 2:
      return "medium";
    case 3:
      return "bad";
    default:
      return "neutral";
  }
}
