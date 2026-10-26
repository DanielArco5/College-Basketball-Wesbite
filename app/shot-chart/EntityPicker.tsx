"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type PickerItem = {
  id: number;
  name: string;
  detail: string;
};

export default function EntityPicker({
  mode,
  items,
  selectedName,
  season,
}: {
  mode: "player" | "team";
  items: PickerItem[];
  selectedName: string;
  /** Carried through every navigation so picking keeps the season. */
  season: number;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 40);
    // Name matches first, then team/conference matches, so typing "duke"
    // finds the school before it finds players who happen to play there.
    const byName: PickerItem[] = [];
    const byDetail: PickerItem[] = [];
    for (const it of items) {
      if (it.name.toLowerCase().includes(q)) byName.push(it);
      else if (it.detail.toLowerCase().includes(q)) byDetail.push(it);
    }
    return [...byName, ...byDetail].slice(0, 40);
  }, [query, items]);

  function choose(item: PickerItem) {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    router.push(`/shot-chart?${mode}=${item.id}&season=${season}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && open && matches[active]) {
      e.preventDefault();
      choose(matches[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div className="controls">
      <div className="modes" role="group" aria-label="Chart subject">
        <button
          type="button"
          className={mode === "player" ? "on" : ""}
          onClick={() => router.push(`/shot-chart?season=${season}`)}
        >
          Players
        </button>
        <button
          type="button"
          className={mode === "team" ? "on" : ""}
          onClick={() => router.push(`/shot-chart?team=all&season=${season}`)}
        >
          Teams
        </button>
      </div>

      <div className="search">
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder={
            mode === "player" ? "Search players" : "Search teams"
          }
          aria-label={mode === "player" ? "Search players" : "Search teams"}
          aria-expanded={open}
          role="combobox"
          aria-controls="picker-list"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
        />

        {open && matches.length > 0 && (
          <ul id="picker-list" className="results" role="listbox">
            {matches.map((item, i) => (
              <li key={item.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  className={i === active ? "active" : ""}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(item)}
                >
                  <span className="r-name">{item.name}</span>
                  <span className="r-detail">{item.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {open && query.trim() && matches.length === 0 && (
          <ul className="results">
            <li className="no-match">
              Nothing matches “{query.trim()}”. Try a last name or a school.
            </li>
          </ul>
        )}
      </div>

      <p className="showing">Showing {selectedName}</p>
    </div>
  );
}
