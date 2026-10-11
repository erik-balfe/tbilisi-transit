# Stops & Lines — UX design

Goal: answer "what's coming and where can it take me?" at a bus stop, without breaking the
trip planner (which stays the first, default flow).

## Principles

1. **Trip planning stays first.** App opens on "Where from?" with the centre pin. Nothing new is
   inserted between the user and From → To → routes.
2. **No new tabs.** The official app splits Stops / Buses / Planner into tabs. Here the map is the
   app, so there is no tab bar. Instead: **one search box** that understands addresses, stop names
   and line numbers, plus the map itself (tap a stop dot).
3. **Show only when it helps.** The "nearby stop" row appears only when we already know where you
   are and you are not planning a trip. Stop dots appear only when zoomed in (z ≥ 15), so the
   city view stays clean.
4. **Predict, don't push.** A tapped line row opens the line. A tapped stop row still sets the
   trip point (that's what people mean 99 % of the time in a From/To box); departures for that
   stop are one extra tap on its clock button.
5. **Back never loses work.** Line/stop views are a stack on top of whatever you had (picker or
   planned trip). Back (button or Android back) pops one level; the planned trip is still there.
6. **Honest data.** Every time says if it is *live* (TTC GPS via Transitous) or *scheduled*.
   Offline everything still works from the bundled GTFS, labelled scheduled.

## User stories

| # | As a rider… | Flow (taps) |
|---|-------------|-------------|
| S1 | I'm at a stop and want to know what arrives next | Location on → "Nearby" row shows the nearest stop + next 3 lines → tap → departures (1 tap). Or tap the stop dot on the map. |
| S2 | I see bus **314** arriving and want to know where it goes | Tap search → type `314` → Lines show first → tap → line drawn on map in its colour, direction toward the terminal, stops listed (2 taps + typing). |
| S3 | …from the stop I'm standing at | From departures, tap the 314 row → line opens in *that* direction, the part **from my stop onward** is highlighted, the passed part is faded, times are for that very bus. |
| S4 | I spot a stop on that line I want to reach | Tap the stop in the list (map centres on it) → **Go here** → planner runs with From = boarding stop (if I came from a stop) or my location, To = that stop. |
| S5 | Which way is this bus going? | Direction switch at the top of the line sheet, labelled by terminal ("→ Station Square"), not "A→B". |
| S6 | I tap a stop dot while browsing the map | Stop sheet with departures grouped by line + direction, countdowns, live dot; refreshes every 30 s. |
| S7 | I use the same stop/line every day | Recent lines (chips) and recent stops are shown when the search box is empty. |
| S8 | No network (metro, roaming) | Line shape, stops and scheduled times come from bundled GTFS; departures computed from schedule and marked *scheduled*; an offline note explains it. |
| S9 | I was looking at a planned trip and peeked at a line | Back returns to the same trip, same selected option, routes redrawn. |
| S10 | Where are the 314 buses right now? | Live vehicles of the line (both live and scheduled-estimated) move on the line view, same markers as trip view. |

## Information architecture

```
Map (always)
└─ Bottom sheet / left card
   ├─ Pick  (default)   "Where from?" + search + [Nearby stop row]   ← entry S1
   ├─ Search            one box: Lines → Stops → Places; empty = recent lines/stops/places/trips
   ├─ Trip              results (unchanged)
   ├─ Stop  (new)       stop name · lines chips · departures grouped by line+direction
   └─ Line  (new)       badge + terminals · direction switch · frequency · stop list (expandable rows)
```

Navigation stack: `base (pick | trip) → [stop] → [line] → [stop] …`; each level pushes a history
entry so Android back works in the installed PWA.

## Entry points

- **Search box** (pick card, trip From/To). Numeric or line-code input (`314`, `M1`, `G2`) ranks
  Lines first; stop rows get a clock button for departures. Placeholder hints "address, stop or line №".
- **Map stop dots** at z ≥ 15 in pick/stop/line modes (hidden in trip results to keep routes readable).
- **Nearby row** in the pick card when location is known and no trip is being built.
- **Departure row** → line (direction + boarding stop).
- **Line badge in a trip leg** (route details) → line view of that leg (nice-to-have).

## States

- Line: loading (skeleton) · ready · offline (scheduled only) · data missing (shape from straight
  stop-to-stop lines, noted).
- Stop: loading · live departures · scheduled only (offline or no RT) · nothing in the next hour.
- Nearby: hidden unless location fix ≤ 2 min old, within 600 m of a stop, pick mode, no To set.

## Visual

- Line colour from the app palette (bus blue/green as TTC colours them, metro red/green, cable car amber),
  shape with theme casing like trip routes. Remaining part full strength, passed part 35 % opacity.
- Stops: small white dots with coloured rim; boarding stop bigger; selected stop ring.
- Sheet reuses peek/mid/full drag. Line sheet opens at *mid*, so map + header + first stops are visible.
- Stop list rows are compact (one line); tap expands actions (Go here · Departures) instead of
  showing buttons on every row — less scrolling.

## Data

- `data/lines.json` (~125 KB raw, ~25 KB gz): line index + stop→lines. Precached.
- `data/lines/<id>.json` per line: directions, ordered stops, minute offsets, scheduled start
  times per service, OSM-matched shape (from Transitous at build time). Lazy-loaded, cached by SW,
  and warmed in the background once after install so everything works offline.
- Live: Transitous `/api/v5/stoptimes` (departures, `realTime` flag), `/api/v5/trip` (times for the
  chosen bus at every stop), `/api/v1/map/trips` (moving vehicles).
