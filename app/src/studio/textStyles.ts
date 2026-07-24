import { type TextStyle } from "../api";

/**
 * Curated text-post looks (Instagram/Facebook-style). Backgrounds are gradient
 * stops (1 colour = solid); fonts use Android's built-in family names so no font
 * files are bundled. Values are concrete so posts render identically in the
 * composer and the feed.
 */
export const TEXT_BACKGROUNDS: string[][] = [
  ["#8E2DE2", "#4A00E0"], // violet
  ["#FF512F", "#DD2476"], // sunset
  ["#2193b0", "#6dd5ed"], // ocean
  ["#11998e", "#38ef7d"], // mint
  ["#F7971E", "#FFD200"], // gold
  ["#C31432", "#240B36"], // berry
  ["#1e3c72", "#2a5298"], // navy
  ["#f12711", "#f5af19"], // fire
  ["#FFB88C", "#DE6262"], // peach
  ["#141E30", "#243B55"], // slate
  ["#111111"], // solid black
  ["#ffffff"], // solid white
];

export const TEXT_FONTS: { label: string; font: string | null }[] = [
  { label: "Classic", font: null },
  { label: "Serif", font: "serif" },
  { label: "Mono", font: "monospace" },
  { label: "Heavy", font: "sans-serif-black" },
  { label: "Light", font: "sans-serif-light" },
  { label: "Script", font: "cursive" },
  { label: "Condensed", font: "sans-serif-condensed" },
];

export const TEXT_COLORS = ["#ffffff", "#000000", "#FFD200", "#FF4081", "#00E5FF", "#B9F6CA"];

export const DEFAULT_TEXT_STYLE: TextStyle = {
  bg: TEXT_BACKGROUNDS[0],
  color: "#ffffff",
  font: null,
  align: "center",
  bold: true,
};

/** Rough perceptual lightness of a #rgb/#rrggbb colour. */
export function isLight(hex: string): boolean {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6;
}
