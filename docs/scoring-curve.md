# The logistic scoring curve + tier thresholds

Owner spec 2026-07-17, implemented the same day. Replaces the original
3-point-line table (100 inside / 250 at the line / +10 per m / cap 500).
The 3-point line is court art now - it plays no scoring role.

## The model

Every made basket banks `basePts` (100), plus a logistic distance bonus:

    add(d) = maxAdd * (sig(k(d - mid)) - sig(k(edge - mid)))
                      / (1 - sig(k(edge - mid)))

- `edge` = `BALANCE.move.hoopStandoffM` (5 m), the closest legal shot -
  the "normal score point", add exactly 0.
- Normalized so the flat tail is exactly `maxAdd`.
- Shape: stepping out of the keep-out zone pays off FAST; past `mid`
  the gains diminish; the deep court is flat well before the baseline.

Owner correction (2026-07-17): the max ADD equals the BASE, not 2x it.
Owner rework (2026-07-19, with the court shortening - the left edge
pulled to 250 px left of the old center, x 6.1875): every curve's
midpoint sits at the SHORTENED court's center (~9.33 m from the rim -
the drawn center circle IS the drop-off landmark), and the max add is
75% of the base. The farthest reachable shot is now ~20 m; the tiers
differ only by ramp steepness (k).

| Hoop | mid | k | maxAdd | max hit | flat from |
|---|---|---|---|---|---|
| 1 | ~9.33 m (court center) | 0.6 | +75 | 175 | ~16 m |
| 2+ | ~9.33 m (court center) | 0.5 | +75 | 175 | ~18 m |
| 3 upper rim | same curve x1.25 | | +94 | 219 | ~18 m |

Special cases:

- **Purple orb throw (slam)**: flat `slamPts` (100) PER RIM, clamped to
  the double - a teleport double through both tier-3 rims pays 200
  (owner 2026-07-19; was flat 100 no matter the rims). Distance stays
  ignored - the orb is a traversal toy, not a strategy.
- **Double shot** (tier 3, both rims one throw): SUM of the rims -
  lower pays the curve, upper pays x1.25, together 2.25x. Range
  225 (edge) to 394 (deep court). Was `points x rims`.
- Rounding: each rim's value rounds independently (`rimPoints`), the
  double sums the rounded values.

## Sign-off table (pinned by src/scoring.test.ts)

| Dist | Hoop 1 | Hoop 2 / H3 lower | H3 upper | H3 double |
|---|---|---|---|---|
| 5 m | 100 | 100 | 125 | 225 |
| 8 m | 119 | 120 | 150 | 270 |
| 10 m | 143 | 140 | 175 | 315 |
| 12.5 m | 165 | 161 | 201 | 362 |
| 16 m | 174 | 172 | 215 | 387 |
| 20 m | 175 | 175 | 219 | 394 |

## Thresholds - anchored to 3 bad players x 15 min/day (owner call 2026-07-18)

The budget is ENERGY now: cap 5 balls, one regenerating every 10
minutes, the clock starting on the throw from full (shared/budget.ts).
A 15-minute session therefore yields ~6 throws (5 stock + 1 regen).

The anchor trio: bad players landing ~3 close-range hits each per
session (owner correction 2026-07-18, was 1.5) at ~110 pts (Hoop 1
curve) / ~105 pts (Hoop 2 curve):

| | income/day (trio) | threshold | lands |
|---|---|---|---|
| Hoop 2 | ~990 at Hoop 1 | **1000** | end of day 1 |
| Hoop 3 | ~945 at Hoop 2 | **2000** | day 3 |

Players who stay longer than 15 minutes farm regen balls (6 per extra
hour) and finish faster - that is the point of the energy model: time
in the court converts to progress, not just skill.

## Implementation map

- `shared/scoring.ts` - `pointsForDistance(distM, tierId)`,
  `rimPoints(distM, tierId, rimId)` (the x1.25), `pointsForRims` (the
  double-shot sum). Params in `BALANCE.score.curves`.
- `shared/simulate.ts` (server) and `backend/local.ts` (offline) both
  score through `pointsForRims`; the client threads the made rim IDS
  through `ShotOutcome.rimIds` -> `Backend.reportOutcome` so offline
  can price the upper rim.
- `CourtScene.rimScoreJuice` previews the same per-rim value at the
  crossing moment.
- `shared/shareRoll.ts` hot-hand fire now anchors on `basePts` (same
  semantics: 1.5x what the hits were worth from the closest spot).

## Knobs left as-is, deliberately

- `bigScorePts: 300` (the rainbow log line): after the 2026-07-19
  rework no SINGLE hit reaches it at any tier (max 219, the deep upper
  rim) - rainbows now only fire on doubles (315+ past ~10 m), slams
  never. Flag for the owner if singles should still celebrate.
