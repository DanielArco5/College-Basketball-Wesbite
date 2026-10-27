# Updating the site

Most of it updates itself. This is what you do by hand, and where.

## Runs on its own (GitHub Actions)

| What | When | Where to check |
|---|---|---|
| Live Wire news (ESPN, CBS Sports) | Every 3 hours | GitHub → Actions → **Live Wire news** |
| Shot charts, NCAA stats, Top 25 re-rank | Every morning, ~7 a.m. ET | GitHub → Actions → **Daily update** |
| Scores and top scorers in the ticker | Live, every 2 minutes | Nothing to do |

To run either job now: Actions → pick the job → **Run workflow**.
A red ✗ there means a run failed; click it to see why. The site keeps
showing the last good data in the meantime.

## Change the Top 25 by hand

Supabase → **Table Editor** → `top25_overrides` → **Insert row**:

- `school`: as the site spells it (`UConn`, `St. John's`, `Miami`)
- `rank`: 1–25, 26–35 for honorable mentions, `0` to drop a team
- `note`: optional; shows when someone hovers the "Our pick" tag

It shows on the site within 5 minutes. To undo, uncheck `is_active` or
delete the row. Teams you don't pin keep the formula's daily order.

## Post your own Live Wire item

Supabase → **Table Editor** → `live_wire_entries` → **Insert row**:

- `kind`: `injury`, `transfer`, `commitment` or `note`
- `headline`: one line
- `url`: link to the source (optional)
- `is_live`: check it, or it stays a hidden draft

Injuries from the past week run right after the scores, so a big injury
gets seen. To pull a bad auto-fetched headline, uncheck its `is_live`.

## Change code or design

Edit locally (or ask Claude), then:

```
cd ~/Documents/cbb-website
git add -A
git commit -m "what changed"
git push
```

Vercel redeploys on every push, in a minute or two.

## Never

- Commit `.env.local` (it's ignored; keep it that way).
- Put the service-role key anywhere with a `NEXT_PUBLIC_` name.
