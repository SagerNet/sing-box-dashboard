// Mirrors ANSIColors.swift and Color+Extension.swift from sing-box-for-apple:
// the same palette, the same style-replacement semantics (each escape
// sequence replaces the current style instead of merging into it), the same
// crude 38...125 color-cube approximation, and the same WCAG contrast
// adjustment against the view background.

export type Rgb = [number, number, number];

export interface AnsiStyle {
  color?: Rgb;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface AnsiSegment {
  text: string;
  style: AnsiStyle | null;
}

const CLIENT_COLORS: Record<string, Rgb> = {
  "30": [0, 0, 0],
  "31": [255, 33, 89],
  "32": [46, 204, 112],
  "33": [230, 230, 0],
  "34": [51, 153, 219],
  "35": [156, 89, 181],
  "36": [92, 173, 227],
  "37": [237, 240, 242],
};

// eslint-disable-next-line no-control-regex -- \x1b is the ANSI escape introducer
const ANSI_PATTERN = /\x1b\[[;\d]*m/g;

// Mirrors ANSIColors.parseAnsiCode: returns the style this sequence switches
// to, or null for a reset / unstyled sequence.
function parseSequence(sequence: string): AnsiStyle | null {
  const codes = sequence.slice(2, -1).split(";").filter((code) => code !== "");
  const style: AnsiStyle = {};
  let hasAttribute = false;
  for (const code of codes) {
    if (code === "0") {
      return null;
    }
    if (code === "1") {
      style.bold = true;
      hasAttribute = true;
    } else if (code === "3") {
      style.italic = true;
      hasAttribute = true;
    } else if (code === "4") {
      style.underline = true;
      hasAttribute = true;
    } else if (CLIENT_COLORS[code]) {
      style.color = CLIENT_COLORS[code];
      hasAttribute = true;
    } else {
      const codeInt = Number(code);
      if (Number.isInteger(codeInt) && codeInt >= 38 && codeInt <= 125) {
        const adjusted = codeInt % 125;
        const row = Math.floor(adjusted / 36);
        const column = adjusted % 36;
        style.color = [row * 51, Math.floor(column / 6) * 51, (column % 6) * 51];
        hasAttribute = true;
      }
    }
  }
  return hasAttribute ? style : null;
}

export function parseAnsi(text: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  let style: AnsiStyle | null = null;
  let cursor = 0;
  ANSI_PATTERN.lastIndex = 0;
  for (let match = ANSI_PATTERN.exec(text); match !== null; match = ANSI_PATTERN.exec(text)) {
    if (match.index > cursor) {
      segments.push({ text: text.slice(cursor, match.index), style });
    }
    style = parseSequence(match[0]);
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), style });
  }
  return segments;
}

export function stripAnsi(text: string): string {
  ANSI_PATTERN.lastIndex = 0;
  return text.replace(ANSI_PATTERN, "");
}

function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance([red, green, blue]: Rgb): number {
  return 0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue);
}

function contrastRatio(left: Rgb, right: Rgb): number {
  const l1 = relativeLuminance(left);
  const l2 = relativeLuminance(right);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Mirrors adjustedForContrast(against:minRatio:): binary-search a blend
// toward black (light backgrounds) or white (dark backgrounds) until the
// WCAG contrast ratio reaches the minimum.
function adjustForContrast(color: Rgb, background: Rgb, minRatio = 4.5): Rgb {
  if (contrastRatio(color, background) >= minRatio) {
    return color;
  }
  const [red, green, blue] = color;
  const shouldDarken = relativeLuminance(background) > 0.5;
  let low = 0;
  let high = 1;
  let best = color;
  for (let i = 0; i < 10; i++) {
    const mid = (low + high) / 2;
    const adjusted: Rgb = shouldDarken
      ? [red * (1 - mid), green * (1 - mid), blue * (1 - mid)]
      : [red + (255 - red) * mid, green + (255 - green) * mid, blue + (255 - blue) * mid];
    if (contrastRatio(adjusted, background) >= minRatio) {
      best = adjusted;
      high = mid;
    } else {
      low = mid;
    }
  }
  return best;
}

const adjustedCache = new Map<string, string>();

export function ansiColorCss(color: Rgb, background: Rgb): string {
  const key = `${color.join(",")}|${background.join(",")}`;
  const cached = adjustedCache.get(key);
  if (cached) {
    return cached;
  }
  const [red, green, blue] = adjustForContrast(color, background);
  const css = `rgb(${Math.round(red)},${Math.round(green)},${Math.round(blue)})`;
  if (adjustedCache.size > 4096) {
    adjustedCache.clear();
  }
  adjustedCache.set(key, css);
  return css;
}

export function parseCssColor(value: string): Rgb | null {
  const text = value.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const num = parseInt(hex[1], 16);
    return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
  }
  const shortHex = /^#([0-9a-f]{3})$/i.exec(text);
  if (shortHex) {
    const [r, g, b] = shortHex[1];
    return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16)];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(text);
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  return null;
}
