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
  the gains diminish; the deep court is flat well before the baseline
  (farthest reachable shot ~26 m).

Owner correction (same day): the max ADD equals the BASE, not 2x it -
all adds halved from the first draft.

| Hoop | mid | k | maxAdd | max hit | flat from |
|---|---|---|---|---|---|
| 1 | 10 m (2x zone) | 0.6 | +100 | 200 | ~16 m |
| 2+ | 12.5 m (2.5x zone) | 0.5 | +125 | 225 | ~20 m |
| 3 upper rim | same curve x1.25 | | +156 | 281 | ~20 m |

Special cases:

- **Purple orb throw (slam)**: flat `basePts` (100). Distance ignored -
  the orb is a traversal toy, not a strategy (was 500, which dwarfed
  every curve value).
- **Double shot** (tier 3, both rims one throw): SUM of the rims -
  lower pays the curve, upper pays x1.25, together 2.25x. Range
  225 (edge) to 787 (deep court). Was `points x rims`.
- Rounding: each rim's value rounds independently (`rimPoints`), the
  double sums the rounded values.

## Sign-off table (pinned by src/scoring.test.ts)

| Dist | Hoop 1 | Hoop 2 / H3 lower | H3 upper | H3 double |
|---|---|---|---|---|
| 5 m | 100 | 100 | 125 | 225 |
| 8 m | 119 | 109 | 136 | 245 |
| 10 m | 148 | 126 | 158 | 284 |
| 12.5 m | 181 | 161 | 201 | 362 |
| 16 m | 197 | 206 | 258 | 464 |
| 26 m | 200 | 225 | 281 | 506 |

## Thresholds - anchored to LOW-SKILLED players (owner call)

The daily budget is 10 balls (owner 2026-07-17, was 5). Thresholds are
the original low-skill anchors x2.5 - the owner's rule: doubling the
balls is worth MORE than 2x the score, because players get more
chances to learn from their misses.

- **Hoop 2: threshold 1250**
- **Hoop 3: threshold 2500**

The anchor trio stays the low-skilled one (close-range hits, ~110
pts/hit on the corrected curve); faster groups still finish in a
fraction of the time.

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

- `bigScorePts: 300` (the rainbow log line): on Hoop 1 the max hit is
  exactly 300, so rainbows only fire from tier 2 on. Flagged to the
  owner in the balancing session; drop to ~250 if Hoop 1 should
  celebrate its deepest bombs.
