"use client";

import { useSyncExternalStore } from "react";

export type WireEntry = {
  id: number;
  kind: "transfer" | "commitment" | "injury" | "note";
  headline: string;
  url: string | null;
  published_at: string;
};

const KIND_LABEL: Record<WireEntry["kind"], string> = {
  transfer: "Transfer",
  commitment: "Commit",
  injury: "Injury",
  note: "Note",
};

// Whether the viewer has hidden the ticker. The choice lives in
// localStorage and is mirrored onto <html data-wire="off"> by the inline
// script in layout.tsx before first paint, so a hidden ticker never
// flashes in on load. CSS does the hiding; this store only keeps the
// button label and aria-pressed in step.
// Keep in sync with the key in layout.tsx's inline script.
const WIRE_STORAGE_KEY = "cbb:wire";

function subscribeWire(onChange: () => void) {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributeFilter: ["data-wire"] });
  return () => obs.disconnect();
}

function setWireHidden(hidden: boolean) {
  document.documentElement.dataset.wire = hidden ? "off" : "on";
  try {
    localStorage.setItem(WIRE_STORAGE_KEY, hidden ? "off" : "on");
  } catch {
    // Private mode or blocked storage: the toggle still works for this
    // page view, it just won't be remembered.
  }
}

// The viewer's reduced-motion setting, read as an external store so it
// stays current if they change it while the page is open. The server
// can't know it, so it renders the animated version and the client
// corrects on hydration.
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * Scrolling news ticker, fed by hand from the live_wire_entries table.
 *
 * Motion is the whole point of a ticker and also the thing that makes
 * some people ill, so a viewer who has asked their system for reduced
 * motion gets the same entries as a static, scrollable row instead.
 * Hovering or focusing pauses it either way — a headline you can't finish
 * reading is worse than no headline. Anyone who'd rather not have it at
 * all can collapse it to a single button, and the choice sticks.
 */
export default function LiveWire({ entries }: { entries: WireEntry[] }) {
  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
  const hidden = useSyncExternalStore(
    subscribeWire,
    () => document.documentElement.dataset.wire === "off",
    () => false,
  );

  if (entries.length === 0) return null;

  // The track holds two copies so the scroll wraps without a visible jump.
  // With reduced motion there's no animation, so one copy is enough.
  const items = reduced ? entries : [...entries, ...entries];

  return (
    <aside
      className={`wire${reduced ? " is-static" : ""}`}
      aria-label="Latest college basketball news"
    >
      <span className="wire-flag">Live Wire</span>
      <div className="wire-window">
        <div
          className="wire-track"
          // The duplicated half is decorative; a screen reader should hear
          // each headline once.
          style={{ animationDuration: `${Math.max(30, entries.length * 9)}s` }}
        >
          {items.map((e, i) => {
            const dup = !reduced && i >= entries.length;
            const body = (
              <>
                <span className={`wire-kind k-${e.kind}`}>
                  {KIND_LABEL[e.kind]}
                </span>
                {e.headline}
              </>
            );
            return (
              <span
                className="wire-item"
                key={`${e.id}-${i}`}
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
      <button
        type="button"
        className="wire-toggle"
        onClick={() => setWireHidden(!hidden)}
      >
        <span className="wire-toggle-off">Hide</span>
        <span className="wire-toggle-on">Show Live Wire</span>
      </button>
    </aside>
  );
}
