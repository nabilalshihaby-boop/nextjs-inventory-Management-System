// Global theme engine, ported from design/Theme Settings.html (pure: safe on server and client).
// The design kept its theme in localStorage via theme.js; here the validated ThemeState is stored
// in SystemSettings.theme (MySQL) and turned into CSS variables on the server.
import { z } from "zod";

export const HEX = /^#[0-9a-f]{6}$/i;

export const BRAND_KEYS = [
  ["primary", "Primary Color"],
  ["primaryHover", "Primary Hover Color"],
  ["accent", "Accent Color"],
  ["bgApp", "App Background Color"],
  ["surface", "Surface / Card Background Color"],
  ["border", "Border Color"],
  ["text1", "Main Text Color"],
  ["text2", "Secondary Text Color"],
] as const;
export const SEMANTIC_KEYS = [
  ["success", "Success Color"],
  ["warning", "Warning Color"],
  ["danger", "Danger Color"],
  ["info", "Info Color"],
] as const;
export const MODES = ["Light", "Dark", "System"] as const;
export const SIDEBAR_STYLES = ["Default", "Compact"] as const;
export const RADIUS_OPTIONS = ["Small", "Medium", "Large"] as const;

export type ColorKey = (typeof BRAND_KEYS)[number][0] | (typeof SEMANTIC_KEYS)[number][0];
export type ThemeState = Record<ColorKey, string> & {
  mode: (typeof MODES)[number];
  sidebar: (typeof SIDEBAR_STYLES)[number];
  radius: (typeof RADIUS_OPTIONS)[number];
};

/** Bluepiller defaults: the app/colors.css tokens resolved to sRGB hex (radius Medium = current tokens). */
export const DEFAULT_THEME: ThemeState = {
  primary: "#007a81",
  primaryHover: "#006166",
  accent: "#f2a036",
  bgApp: "#f0f4f7",
  surface: "#ffffff",
  border: "#e1e7eb",
  text1: "#111c23",
  text2: "#3f4950",
  success: "#0fa05c",
  warning: "#dfa11a",
  danger: "#db4241",
  info: "#0486d3",
  mode: "Light",
  sidebar: "Default",
  radius: "Medium",
};

const hexField = z.string().regex(HEX, "Enter a valid hex code, e.g. #0e7490").transform((v) => v.toLowerCase());
export const themeStateSchema = z.object({
  primary: hexField,
  primaryHover: hexField,
  accent: hexField,
  bgApp: hexField,
  surface: hexField,
  border: hexField,
  text1: hexField,
  text2: hexField,
  success: hexField,
  warning: hexField,
  danger: hexField,
  info: hexField,
  mode: z.enum(MODES),
  sidebar: z.enum(SIDEBAR_STYLES),
  radius: z.enum(RADIUS_OPTIONS),
});

/** Parse a stored/submitted theme; anything invalid → null (callers fall back to defaults). */
export function parseTheme(value: unknown): ThemeState | null {
  const r = themeStateSchema.safeParse(value);
  return r.success ? r.data : null;
}

export function isDefaultTheme(s: ThemeState) {
  return (Object.keys(DEFAULT_THEME) as (keyof ThemeState)[]).every((k) => s[k] === DEFAULT_THEME[k]);
}

// ---- color math (same formulas as the design) ----
const RADII: Record<ThemeState["radius"], [number, number, number, number]> = {
  Small: [2, 4, 8, 12],
  Medium: [4, 8, 12, 16],
  Large: [8, 12, 16, 24],
};
export const DARK_NEUTRALS = { bgApp: "#0f1a1f", surface: "#16242b", border: "#2a3b44", text1: "#e8f0f3", text2: "#b4c3ca" };
const NEUTRAL_KEYS = ["bgApp", "surface", "border", "text1", "text2"] as const;

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (a: number[]) => "#" + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
export const mix = (a: string, b: string, t: number) => {
  const x = rgb(a), y = rgb(b);
  return hex(x.map((v, i) => v * t + y[i] * (1 - t)));
};
const lum = (h: string) => {
  const [r, g, b] = rgb(h).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string) => {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const fit = (h: string, bg: string, min = 4.5) => {
  const to = lum(bg) > 0.4 ? "#000000" : "#ffffff";
  let c = h;
  for (let t = 0; t <= 1 && contrast(c, bg) < min; t += 0.04) c = mix(to, h, t);
  return c;
};

/** Neutral colors for a theme mode (System resolves with the given preference). */
export function modeNeutrals(mode: ThemeState["mode"], prefersDark: boolean) {
  const dark = mode === "Dark" || (mode === "System" && prefersDark);
  return dark ? { ...DARK_NEUTRALS } : Object.fromEntries(NEUTRAL_KEYS.map((k) => [k, DEFAULT_THEME[k]])) as typeof DARK_NEUTRALS;
}

/** CSS variable overrides for a theme, relative to the defaults (only changed groups are emitted). */
export function varsFor(s: ThemeState, O: ThemeState = DEFAULT_THEME): Record<string, string> {
  const v: Record<string, string> = {};
  const ch = (ks: readonly (keyof ThemeState)[]) => ks.some((k) => s[k] !== O[k]);
  const W = "#ffffff";
  if (ch(["primary", "primaryHover"])) {
    const p = s.primary, h = s.primaryHover;
    Object.assign(v, {
      "--primary-50": mix(p, W, 0.07), "--primary-100": mix(p, W, 0.14), "--primary-200": mix(p, W, 0.3),
      "--primary-300": mix(p, W, 0.5), "--primary-400": mix(p, W, 0.75), "--primary-500": mix(p, h, 0.6),
      "--primary-600": p, "--primary-700": h, "--primary-800": mix(h, "#000000", 0.78), "--primary-900": mix(h, "#000000", 0.55),
      "--tone-teal": fit(p, W),
    });
  }
  if (ch(["accent"])) {
    const a = s.accent;
    Object.assign(v, {
      "--accent-50": mix(a, W, 0.1), "--accent-100": mix(a, W, 0.22), "--accent-300": mix(a, W, 0.55),
      "--accent-500": a, "--accent-600": mix(a, "#000000", 0.88), "--accent-700": mix(a, "#000000", 0.6),
    });
  }
  if (ch(NEUTRAL_KEYS)) {
    const sub = mix(s.surface, s.bgApp, 0.4), bs = mix(s.border, s.text2, 0.85);
    Object.assign(v, {
      "--bg-app": s.bgApp, "--bg-surface": s.surface, "--bg-subtle": sub, "--border": s.border, "--border-strong": bs,
      "--text-1": s.text1, "--text-2": s.text2, "--text-3": mix(s.text2, s.surface, 0.8),
      "--neutral-0": s.surface, "--neutral-50": sub, "--neutral-100": s.bgApp, "--neutral-200": s.border, "--neutral-300": bs,
      "--neutral-400": mix(s.text2, s.surface, 0.5), "--neutral-500": mix(s.text2, s.surface, 0.75),
      "--neutral-600": mix(s.text2, s.surface, 0.9), "--neutral-700": s.text2, "--neutral-900": s.text1,
    });
  }
  const tone = { success: "green", warning: "amber", danger: "red", info: "blue" } as const;
  for (const [k] of SEMANTIC_KEYS) {
    if (!ch([k])) continue;
    const c = s[k], bg = mix(c, s.surface, 0.1);
    Object.assign(v, {
      [`--${k}-50`]: bg, [`--${k}-100`]: mix(c, s.surface, 0.22), [`--${k}-500`]: c,
      [`--${k}-700`]: fit(c, bg), [`--tone-${tone[k]}`]: fit(c, W),
    });
  }
  if (s.radius !== O.radius) {
    const r = RADII[s.radius];
    Object.assign(v, { "--radius-sm": `${r[0]}px`, "--radius-md": `${r[1]}px`, "--radius-lg": `${r[2]}px`, "--radius-xl": `${r[3]}px` });
  }
  return v;
}

// Defence in depth: only well-formed variable names and hex/px values ever reach CSS text.
const SAFE_NAME = /^--[a-z0-9-]+$/;
const SAFE_VALUE = /^(#[0-9a-f]{6}|\d{1,3}px)$/i;
const declarations = (vars: Record<string, string>) =>
  Object.entries(vars)
    .filter(([k, v]) => SAFE_NAME.test(k) && SAFE_VALUE.test(v))
    .map(([k, v]) => `${k}:${v}`)
    .join(";");

/**
 * CSS for the saved global theme, applied to :root on authenticated dashboard pages.
 * Light/Dark use the saved neutrals; System uses the light neutrals plus a
 * prefers-color-scheme: dark override with the dark neutrals.
 */
export function themeCss(s: ThemeState): string {
  if (s.mode !== "System") return `:root{${declarations(varsFor(s))}}`;
  const light = varsFor({ ...s, ...modeNeutrals("System", false) });
  const dark = varsFor({ ...s, ...modeNeutrals("System", true) });
  return `:root{${declarations(light)}}@media (prefers-color-scheme: dark){:root{${declarations(dark)}}}`;
}
