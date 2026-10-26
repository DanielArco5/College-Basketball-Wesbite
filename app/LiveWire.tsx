"use client";

import { useSyncExternalStore } from "react";

export type WireEntry = {
  id: number;
  kind: "transfer" | "commitment" | "injury" | "note";
  headline: string;
  url: string | null;
  published_at: string;
};

/**
 * Each kind reads like a stock symbol with a direction: a team gaining a
 * player is up, losing one to injury is down, a note is flat.
 */
const TICKER: Record<WireEntry["kind"], { sym: string; arrow: string; tone: string; label: string }> = {
  transfer: { sym: "XFER", arrow: "▲", tone: "up", label: "Transfer" },
  commitment: { sym: "COMMIT", arrow: "▲", tone: "up", label: "Commitment" },
  injury: { sym: "INJ", arrow: "▼", tone: "down", label: "Injury" },
  note: { sym: "NOTE", arrow: "●", tone: "flat", label: "Note" },
};

/** "OCT 20". Fixed time zone so server and browser print the same date. */
function stamp(iso: string) {
  return new Date(iso)
    .toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })
    .toUpperCase();
}

const STORAGE_KEY = "cbb.wire";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

// Both values live outside React (a media query, and the data-wire
// attribute SiteChrome's inline script sets before first paint), so they
// are read as external stores. The server can't know either, so it
// renders the open, animated version and the client corrects on hydration.
function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function subscribeWire(onChange: () => void) {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributeFilter: ["data-wire"] });
  return () => obs.disconnect();
}

/**
 * Scrolling news ticker, fed by hand from live_wire_entries, styled like
 * a market tape: symbol, direction arrow, headline, date.
 *
 * Two things a ticker has to get right or it becomes an irritant:
 *
 * Motion. It's the whole point of the format and also the thing that
 * makes some people ill, so a viewer whose system asks for reduced
 * motion gets the same entries as a static row. Hover and focus pause it
 * either way — a headline you can't finish reading is worse than none.
 *
 * An exit. Anything that moves forever at the top of every page needs an
 * off switch. The choice is remembered per browser, and collapsing
 * leaves a thin bar rather than vanishing, so it can always be found
 * again.
 */
export default function LiveWire({ entries }: { entries: WireEntry[] }) {
  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
  // Mirrors the data-wire attribute that the inline script in SiteChrome
  // already set before first paint, so this never fights what's on screen.
  const open = useSyncExternalStore(
    subscribeWire,
    () => document.documentElement.dataset.wire !== "off",
    () => true,
  );

  function toggle() {
    const next = !open;
    // Setting the attribute re-renders through subscribeWire.
    document.documentElement.dataset.wire = next ? "on" : "off";
    // Private windows and blocked site data both throw here; the toggle
    // should still work for this session.
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
    } catch {
      /* preference just won't survive a reload */
    }
  }

  if (entries.length === 0) return null;

  // Two copies so the scroll wraps without a visible jump. With reduced
  // motion there's no animation, so one is enough.
  const items = reduced || !open ? entries : [...entries, ...entries];

  return (
    <aside
      className={`wire${reduced ? " is-static" : ""}${open ? "" : " is-closed"}`}
      aria-label="Latest college basketball news"
    >
      <span className="wire-flag">
        <span className="wire-dot" aria-hidden="true" />
        <span className="wire-flag-live">Live</span>
        <span className="wire-flag-name">Wire</span>
      </span>

      {open && (
        <div className="wire-window">
          <div
            className="wire-track"
            style={{
              animationDuration: `${Math.max(30, entries.length * 9)}s`,
            }}
          >
            {items.map((e, i) => {
              const dup = !reduced && i >= entries.length;
              const t = TICKER[e.kind];
              const body = (
                <>
                  <span className="wire-sym" aria-hidden="true">
                    {t.sym}
                  </span>
                  <span className="wire-chg" aria-hidden="true">
                    {t.arrow}
                  </span>
                  <span className="sr-only">{t.label}: </span>
                  <span className="wire-head">{e.headline}</span>
                  <time className="wire-time" dateTime={e.published_at}>
                    {stamp(e.published_at)}
                  </time>
                </>
              );
              return (
                <span
                  className={`wire-item t-${t.tone}`}
                  key={`${e.id}-${i}`}
                  // The duplicated half is decorative; a screen reader
                  // should hear each headline once.
                  aria-hidden={dup || undefined}
                >
                  {e.url ? (
                    <a href={e.url} target="_blank" rel="noopener noreferrer">
                      {body}
                    </a>
                  ) : (
                    body
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <button
        type="button"
        className="wire-toggle"
        onClick={toggle}
        aria-expanded={open}
      >
        {open ? "Hide" : `Show ${entries.length}`}
      </button>
    </aside>
  );
}
