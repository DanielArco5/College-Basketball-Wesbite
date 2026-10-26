"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "./Logo";

/**
 * Season labels are part of the navigation, not decoration. The shot
 * charts describe a finished season and the ratings project the one
 * about to start, so a reader who sees only "Shot charts" and "Top 25"
 * has no way to know they aren't about the same games.
 */
const LINKS = [
  { href: "/", label: "Home", season: null, ready: true },
  { href: "/shot-chart", label: "Shot charts", season: "2026-27 + 2025-26", ready: true },
  { href: "/rankings", label: "Top 25", season: "2026-27", ready: true },
];

export default function SiteNav() {
  const path = usePathname();

  return (
    <nav className="sitenav" aria-label="Main">
      <Link href="/" className="sitenav-mark" aria-label="CBB home">
        <Logo size={26} />
      </Link>

      <ul>
        {LINKS.filter((l) => l.href !== "/").map((l) => {
          const active = path === l.href || path.startsWith(`${l.href}/`);

          if (!l.ready) {
            return (
              <li key={l.href}>
                <span className="sitenav-link is-pending" aria-disabled="true">
                  {l.label}
                  <span className="sitenav-season">{l.season}</span>
                </span>
              </li>
            );
          }

          return (
            <li key={l.href}>
              <Link
                href={l.href}
                className={`sitenav-link${active ? " is-active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                {l.label}
                {l.season && (
                  <span className="sitenav-season">{l.season}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
