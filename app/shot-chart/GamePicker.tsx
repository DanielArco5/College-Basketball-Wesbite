"use client";

import { useRouter } from "next/navigation";

export type GameOption = { id: number; label: string };

/**
 * Switch between the whole season and one game. `base` is the page's URL
 * without a game; picking a game adds &game=<id>.
 */
export default function GamePicker({
  games,
  selected,
  base,
}: {
  games: GameOption[];
  selected: number | null;
  base: string;
}) {
  const router = useRouter();
  if (games.length === 0) return null;
  return (
    <label className="game-picker">
      <span>Game</span>
      <select
        value={selected ?? ""}
        onChange={(e) => router.push(e.target.value ? `${base}&game=${e.target.value}` : base, { scroll: false })}
      >
        <option value="">
          Whole season ({games.length} game{games.length === 1 ? "" : "s"})
        </option>
        {games.map((g) => (
          <option key={g.id} value={g.id}>
            {g.label}
          </option>
        ))}
      </select>
    </label>
  );
}
