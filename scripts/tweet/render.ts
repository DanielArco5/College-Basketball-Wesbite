/**
 * Shared pieces of the tweet images: the frame, the palette, and turning
 * an SVG string into a PNG.
 *
 * The fonts are bundled (scripts/fonts, Geist, the site's typeface) and
 * system fonts are off, so an image comes out the same on a laptop and on
 * the GitHub runner.
 */

import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

/** 16:9, the shape X shows in the timeline without cropping. */
export const W = 1200;
export const H = 675;

// The site's palette (app/globals.css, app/Logo.tsx).
export const BG = "#191512";
export const PANEL = "#241C16";
export const RULE = "#3A2F26";
export const FG = "#E8DFD4";
export const MUTED = "#A39685";
export const BALL = "#D04A32";

const FONT_DIR = join(import.meta.dirname, "..", "fonts");

export function toPng(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    // Twice the layout size, so text stays sharp on a phone.
    fitTo: { mode: "width", value: W * 2 },
    font: {
      fontFiles: ["Geist-Regular.ttf", "Geist-Medium.ttf", "Geist-Bold.ttf"].map((f) => join(FONT_DIR, f)),
      loadSystemFonts: false,
      defaultFontFamily: "Geist",
    },
  });
  return Buffer.from(resvg.render().asPng());
}

/** Wrap a card's contents in the page: background, mark, footer. */
export function frame(body: string, footer: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Geist">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  ${body}
  <g transform="translate(${W - 56 - 92}, 36)">${logo(30)}</g>
  <text x="56" y="${H - 26}" font-size="16" fill="${MUTED}">${esc(footer)}</text>
</svg>`;
}

/** The site mark and "CBB" wordmark (app/Logo.tsx), `size` px tall. */
function logo(size: number) {
  const k = size / 32;
  return `<g transform="scale(${k})">
    <circle cx="16" cy="16" r="15" fill="${BALL}"/>
    <g fill="none" stroke="${BG}" stroke-width="1.7" stroke-linecap="round">
      <path d="M16 1v30"/><path d="M1 16h30"/>
      <path d="M5.4 5.4c3.6 3.2 5.4 6.8 5.4 10.6s-1.8 7.4-5.4 10.6"/>
      <path d="M26.6 5.4c-3.6 3.2-5.4 6.8-5.4 10.6s1.8 7.4 5.4 10.6"/>
    </g>
  </g>
  <text x="${size + 9}" y="${size * 0.82}" font-size="${size * 0.86}" font-weight="700" letter-spacing="1" fill="${FG}">CBB</text>`;
}

export function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Cut a string to `max` characters, ending in an ellipsis if cut. */
export function clip(s: string, max: number) {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** "54.5%" from 0.545. */
export function pct(v: number, digits = 1) {
  return `${(100 * v).toFixed(digits)}%`;
}

/**
 * A team color that reads on the dark page. Navy and black primaries
 * vanish against it, so anything too dark is lifted toward white.
 */
export function onDark(hex: string | null | undefined) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return MUTED;
  const rgb = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const luma = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  if (luma >= 0.22) return `#${m[1]}`;
  const lift = (0.22 - luma) / (1 - luma) + 0.25;
  return "#" + rgb.map((c) => Math.round(c + (255 - c) * lift).toString(16).padStart(2, "0")).join("");
}
