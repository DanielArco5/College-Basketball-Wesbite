"use client";

import { useState, type PointerEvent } from "react";
import {
  PX_PER_FT,
  VIEW_H,
  VIEW_W,
  ZONE_LABELS,
  toSvg,
  type Zone,
} from "@/lib/court";
import { CourtLines, SURFACE } from "./ShotChart";

export type GameShot = {
  id: number;
  /** Null for a shot without a location; those aren't drawn. */
  x: number | null;
  y: number | null;
  made: boolean;
  score_value: number | null;
  play_type: string | null;
  player_name: string | null;
  period: number | null;
  clock: string | null;
  assisted: boolean | null;
  dist_ft: number | null;
  zone: Zone | null;
};

/** Court lines on the plain surface: light enough to read, not to compete. */
const COURT_LINE = "#4A3D32";
const MISS = "#9A8B7C";
/** How close the pointer must be to a dot to pick it, in SVG pixels. */
const PICK_PX = 18;
/** Below this chart width the tooltip moves under the chart. */
const NARROW_PX = 520;

const SHOT_NAMES: Record<string, string> = {
  JumpShot: "jumper",
  LayUpShot: "layup",
  DunkShot: "dunk",
  TipShot: "tip-in",
};

function when(period: number | null, clock: string | null) {
  const half =
    period === 1
      ? "1st half"
      : period === 2
        ? "2nd half"
        : period
          ? `OT${period > 3 ? period - 2 : ""}`
          : "";
  return [half, clock].filter(Boolean).join(", ");
}

/** Where a dot goes: past the drawn half court, it sits at the top edge. */
function place(s: GameShot) {
  const { sx, sy } = toSvg(s.x ?? 0, s.y ?? 0);
  return { sx: Math.min(Math.max(sx, 6), VIEW_W - 6), sy: Math.max(sy, 6) };
}

/**
 * One game's shots, each where it was taken: filled for a make, an X for a
 * miss. Hover (or tap) a shot for who, when and what.
 */
export default function GameChart({
  shots: all,
  showShooter,
}: {
  shots: GameShot[];
  showShooter: boolean;
}) {
  const [hover, setHover] = useState<{
    i: number;
    x: number;
    y: number;
    flip: boolean;
    narrow: boolean;
  } | null>(null);
  const [show, setShow] = useState<Filter>("all");
  const shots =
    show === "all" ? all : all.filter((s) => s.made === (show === "made"));
  const placed = shots.map(place);
  const counts = {
    all: all.length,
    made: all.filter((s) => s.made).length,
    missed: all.filter((s) => !s.made).length,
  };

  const track = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * VIEW_W;
    const py = ((e.clientY - box.top) / box.height) * VIEW_H;
    let best = -1;
    let bestD = PICK_PX;
    placed.forEach((p, i) => {
      const d = Math.hypot(p.sx - px, p.sy - py);
      if (d < bestD) [best, bestD] = [i, d];
    });
    if (best < 0) {
      setHover(null);
      return;
    }
    const scale = box.width / VIEW_W;
    const x = placed[best].sx * scale;
    setHover({
      i: best,
      x,
      y: placed[best].sy * scale,
      flip: x > box.width / 2,
      narrow: box.width < NARROW_PX,
    });
  };

  const shot = hover ? shots[hover.i] : undefined;
  const r = 0.75 * PX_PER_FT;

  return (
    <>
      <div
        className="shot-filter"
        role="group"
        aria-label="Which shots to show"
      >
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={show === f.key ? "on" : ""}
            aria-pressed={show === f.key}
            onClick={() => {
              setHover(null);
              setShow(f.key);
            }}
          >
            {f.label} <span className="shot-filter-n">{counts[f.key]}</span>
          </button>
        ))}
      </div>
      <div className="court-wrap">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="court"
          role="img"
          aria-label={`Shot chart for one game: ${shots.filter((s) => s.made).length} makes and ${
            shots.filter((s) => !s.made).length
          } misses. Hover a shot for details.`}
          onPointerMove={track}
          onPointerDown={track}
          onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
        >
          <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill={SURFACE} />
          <CourtLines stroke={COURT_LINE} />

          {/* Misses under makes, so a make is never hidden behind a miss. */}
          <g pointerEvents="none">
            {shots.map((s, i) =>
              s.made ? null : (
                <path
                  key={s.id}
                  d={`M ${placed[i].sx - r} ${placed[i].sy - r} L ${placed[i].sx + r} ${placed[i].sy + r} M ${
                    placed[i].sx + r
                  } ${placed[i].sy - r} L ${placed[i].sx - r} ${placed[i].sy + r}`}
                  stroke={MISS}
                  strokeWidth={2}
                  strokeLinecap="round"
                  opacity={hover && hover.i !== i ? 0.45 : 0.9}
                />
              ),
            )}
            {shots.map((s, i) =>
              s.made ? (
                <circle
                  key={s.id}
                  cx={placed[i].sx}
                  cy={placed[i].sy}
                  r={r}
                  fill="var(--accent)"
                  stroke={SURFACE}
                  strokeWidth={1.5}
                  opacity={hover && hover.i !== i ? 0.5 : 1}
                />
              ) : null,
            )}
            {hover && (
              <circle
                cx={placed[hover.i].sx}
                cy={placed[hover.i].sy}
                r={r + 5}
                fill="none"
                stroke="#F0EBE3"
                strokeWidth={2}
              />
            )}
          </g>
        </svg>

        {hover && shot && (
          <div
            className="zone-tip"
            role="status"
            style={
              hover.narrow
                ? {
                    top: "calc(100% + 6px)",
                    left: "50%",
                    transform: "translateX(-50%)",
                  }
                : {
                    top: hover.y,
                    left: hover.x,
                    transform: `translate(${hover.flip ? "calc(-100% - 16px)" : "16px"}, -50%)`,
                  }
            }
          >
            {showShooter && shot.player_name && (
              <strong>{shot.player_name}</strong>
            )}
            <span className={shot.made ? "zone-tip-good" : "zone-tip-bad"}>
              {shot.made ? "Made" : "Missed"}{" "}
              {shot.score_value === 3 ? "3-pointer" : "2-pointer"}
              {shot.play_type && SHOT_NAMES[shot.play_type]
                ? `, ${SHOT_NAMES[shot.play_type]}`
                : ""}
            </span>
            <span className="zone-tip-dim">
              {[
                shot.dist_ft !== null ? `${Math.round(shot.dist_ft)} ft` : null,
                shot.zone ? ZONE_LABELS[shot.zone] : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {when(shot.period, shot.clock) && (
              <span className="zone-tip-dim">
                {when(shot.period, shot.clock)}
              </span>
            )}
            {shot.made && shot.assisted && (
              <span className="zone-tip-dim">Assisted</span>
            )}
          </div>
        )}
      </div>
      <GameLegend />
    </>
  );
}

type Filter = "all" | "made" | "missed";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All shots" },
  { key: "made", label: "Makes" },
  { key: "missed", label: "Misses" },
];

/** Key under the chart: what a dot and an X mean. */
export function GameLegend() {
  return (
    <div className="game-legend">
      <span>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <circle cx="7" cy="7" r="6" fill="var(--accent)" />
        </svg>
        Made
      </span>
      <span>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path
            d="M 2 2 L 12 12 M 12 2 L 2 12"
            stroke={MISS}
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        Missed
      </span>
      <span className="game-legend-note">Hover or tap a shot for details</span>
    </div>
  );
}
