/** App-wide brand / theme settings (stored on the main Supabase state row). */

export const DEFAULT_GROUP_NAME = "Peachtree Collective";
export const DEFAULT_GROUP_LOGO_URL = "/brand/ptc-peach.png";

export const DEFAULT_COLORS = {
  bg: "#164931",
  bgCard: "#1c5439",
  peach: "#f5946f",
  textMuted: "#9bbfaa",
};

export const COLOR_FIELDS = [
  { key: "bg", label: "Background", hint: "Main page background" },
  { key: "bgCard", label: "Cards", hint: "Cards and panels" },
  { key: "peach", label: "Accent", hint: "Wins, highlights, Discord embeds" },
  { key: "textMuted", label: "Muted text", hint: "Secondary labels" },
];

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value) {
  return typeof value === "string" && HEX_RE.test(value.trim());
}

export function normalizeHex(value) {
  const raw = (value || "").trim();
  if (!isHexColor(raw)) return "";
  const h = raw.slice(1);
  if (h.length === 3) {
    return `#${h.split("").map(c => c + c).join("").toLowerCase()}`;
  }
  return `#${h.toLowerCase()}`;
}

function normalizeColors(colors) {
  if (!colors || typeof colors !== "object") return null;
  const out = {};
  let any = false;
  for (const key of Object.keys(DEFAULT_COLORS)) {
    const normalized = normalizeHex(colors[key]);
    if (normalized) {
      out[key] = normalized;
      any = true;
    }
  }
  return any ? out : null;
}

/** Flat app-level fields kept beside `tournaments` on the main row. */
export function emptyAppSettings() {
  return {
    discordWebhookUrl: null,
    groupName: null,
    groupLogoUrl: null,
    colors: null,
  };
}

export function normalizeAppSettings(state = {}) {
  const groupName = typeof state.groupName === "string" ? state.groupName.trim() : "";
  const groupLogoUrl = typeof state.groupLogoUrl === "string" ? state.groupLogoUrl.trim() : "";
  return {
    discordWebhookUrl: state.discordWebhookUrl?.trim() || null,
    groupName: groupName || null,
    groupLogoUrl: groupLogoUrl || null,
    colors: normalizeColors(state.colors),
  };
}

export function resolveGroupName(settings) {
  return settings?.groupName?.trim() || DEFAULT_GROUP_NAME;
}

export function resolveGroupLogoUrl(settings) {
  return settings?.groupLogoUrl?.trim() || DEFAULT_GROUP_LOGO_URL;
}

/** Effective palette for editors (defaults filled in). */
export function resolveColors(settings) {
  return { ...DEFAULT_COLORS, ...(settings?.colors || {}) };
}

export function splitBrandName(name) {
  const trimmed = (name || "").trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { lead: trimmed, trail: "" };
  return { lead: parts[0], trail: parts.slice(1).join(" ") };
}

function parseRgb(hex) {
  const n = parseInt(normalizeHex(hex).slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function hexToRgba(hex, alpha) {
  const { r, g, b } = parseRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function lightenHex(hex, amount) {
  const { r, g, b } = parseRgb(hex);
  const lift = v => Math.min(255, Math.round(v + (255 - v) * amount));
  const to = v => lift(v).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Discord embed color integer from a hex accent. */
export function peachToDiscordColor(hex) {
  const normalized = normalizeHex(hex) || DEFAULT_COLORS.peach;
  return parseInt(normalized.slice(1), 16);
}

/**
 * Push custom colors onto :root. Unset keys remove inline overrides
 * so the CSS file defaults apply again.
 */
export function applyAppColors(colors) {
  const root = document.documentElement;
  const c = colors || {};

  if (c.bg) {
    root.style.setProperty("--bg", c.bg);
    root.style.setProperty("--green", c.bg);
    root.style.setProperty("--text-on-accent", c.bg);
  } else {
    root.style.removeProperty("--bg");
    root.style.removeProperty("--green");
    root.style.removeProperty("--text-on-accent");
  }

  if (c.bgCard) {
    root.style.setProperty("--bg-card", c.bgCard);
  } else {
    root.style.removeProperty("--bg-card");
  }

  if (c.peach) {
    root.style.setProperty("--peach", c.peach);
    root.style.setProperty("--peach-faint", hexToRgba(c.peach, 0.2));
    root.style.setProperty("--peach-hover", lightenHex(c.peach, 0.12));
  } else {
    root.style.removeProperty("--peach");
    root.style.removeProperty("--peach-faint");
    root.style.removeProperty("--peach-hover");
  }

  if (c.textMuted) {
    root.style.setProperty("--text-muted", c.textMuted);
  } else {
    root.style.removeProperty("--text-muted");
  }
}
