# "Here" — what can I take from the stop I'm standing at

Use case: Erik walks up to a stop with **no planned trip** and wants one obvious button that answers
*where am I and what can I take from here* — instantly, no sequence of taps, maximum information, nothing extra.

## Principles

1. **One tap, no questions.** A round accent button sits bottom-right, directly above the locate button
   (thumb zone, same column, same size family). One tap opens the *Here* sheet. No dialog, no pre-step.
2. **Local first.** The nearest stop and a scheduled departure board come from the local timetable
   (IndexedDB) in the same frame as the sheet opens. Live data (Transitous stoptimes) only *upgrades* rows
   afterwards. Offline = same view, labelled "scheduled".
3. **A position is never blocking.** Use the live fix if < 90 s old, else the last stored fix (< 20 min, shown as
   "last known position · N min ago") while a fresh fix is requested in the background; the view re-targets itself
   if the nearest stop changes.
4. **One view for everything stop-related.** *Here* is the existing stop sheet in "here" mode (same stack, back,
   history, theme, EN/KA). The planned-trip "At the stop" card is folded in: when a trip exists, rows that fit the
   trip are marked and can be filtered ("My trip"). No second widget.

## Entry points

| Where | What |
|-------|------|
| **Here button** (map, bottom-right, above locate; all modes except full-screen search) | Tap → locate → open *Here*. Gets a green dot when a stop is ≤ 100 m away and the position is fresh ("auto-offer"; never opens by itself, never prompts for permission on its own). |
| Nearby row (pick card) | Same view (was: plain stop view). |
| "At the stop" card (planned trip, ≤ 200 m from a boarding stop) | Shows lines that fit the trip with next arrivals; tap header → *Here*. |

## Layout (mobile bottom sheet, mid snap; desktop = left card)

```
┌───────────────────────────────────────────┐
│ ←  (bus) M/S Rustaveli                     │  ← back (restores pick / trip), stop name
│    You are here · 12 m · ±15 m             │  ← state line (live / last known / nearest 640 m away)
│ [M/S Rustaveli 12 m ↗][Rustaveli Ave 45 m ←] │  ← switcher: only if ≥ 2 stops within ~150 m; chips scroll
│ ( Next departures | All lines 14 ) [My trip]│  ← segmented tabs; "My trip" chip only when a trip exists
├───────────────────────────────────────────┤
│ [M1]  → Akhmeteli                  ● 2 min │  ← badge · headline = terminal · minutes (green dot = live)
│       via Freedom Sq › Marjanishvili · 9 stops · 14 min │  ← "where it goes": notable stops + length
│ [314] → Station Sq              scheduled 4 min │
│       via Rustaveli Ave › Freedom Sq ...   │
│ ...                                        │
└───────────────────────────────────────────┘
```

* **Rows are departures, not lines**, sorted by time (next 90 min, max 12; "show more" reveals the rest).
  Each row: line badge, `→ terminal` (headsign), minutes (live = green dot, scheduled = muted), second line =
  *where it goes*.
* **Where it goes** = up to 3 (4 on long routes) notable stops after this one + number of stops + minutes to the end.
  Notable = interchange hubs (many lines serve it), metro stations, cable-car stations; spaced ≥ 3 stops apart, never
  the terminal itself (that is the headline). Computed from the local line files, so it works offline; rows appear
  first and the summary fills in as line files load (no waiting).
* **Tap a row** → existing line view: whole route drawn on the map, *remaining stops* highlighted, passed part
  faded, any stop tappable → **Go here** → trip view (From = this stop). Back returns to *Here* instantly.
* **All lines** tab: every line serving the stop, one row per direction that actually leaves from here:
  badge · `→ terminal` · next time · "every ~N min". For the case when the next bus is 30 min away.
  Tap → line view from this stop.
* **Switcher**: nearest stop is auto-selected. Chips show name, distance and a compass arrow (where the stop is
  relative to you) so the two sides of a road are distinguishable. Tapping a chip pins it (auto re-targeting stops).

## States

| State | Look |
|-------|------|
| Locating (no fix at all) | Sheet opens at once: "Finding your location…" + skeleton rows; the map stays put. |
| Located, stop ≤ 400 m | Normal view. |
| Located, nearest stop > 400 m | State line "Nearest stop · 640 m away" (still shows it). |
| Outside Tbilisi | "You're outside Tbilisi." + no stop. |
| Permission denied / unavailable | Message + *Try again* and *Search a stop* (opens the search). |
| Last-known fix | State line "Last known position · 8 min ago"; replaced when a fresh fix arrives. |
| Offline | Offline pill, rows "scheduled", note "Offline — times from the timetable". |
| Live data arrives | Rows swap in place (no flicker: same keys), green dots appear, footer "updated hh:mm". |
| No service | "No departures in the next 90 minutes" + the *All lines* tab still lists the lines. |

## Refresh policy

Local board is computed immediately; live refresh at open, then every 30 s while the sheet is visible and the tab is
foreground (existing hidden-tab pause); API results cached 25 s (shared with other views). Position: re-fix on open;
while open, a watch is *not* started — a new fix (from the locate button or a 20 s re-check while visible) may
re-target the stop with hysteresis (≥ 25 m closer than the current one).

## Not in scope

Physical-platform detection for merged stops (opposite sides of one road with the same name are one dot in the
data; the board shows both directions, distinguished by terminal), district names (no district data in the feed).
