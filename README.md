# shootDaHoop — gameplay feel prototype

Single-player sandbox for tuning movement, camera, aiming, the throw, and
score juice. See `Gameplay_Spec.md` for the full spec.

## Run

```
npm install
npm run dev
```

## Controls

- **Left-click** — walk to the clicked spot (moves in x and depth)
- **Right-click + hold, drag back** — aim (angle + power, slingshot style)
- **Release right-click** — throw
- **Enter** — chat (messages go to the court-wall log)

## Tuning

Every feel knob (gravity, power curve, hang time, camera zoom, juice
intensity…) lives in **`src/tuning.ts`**. Edit + save → Vite hot-reloads.

Final art/sound goes in `public/assets/` — see the README there for the
file manifest. Missing assets fall back to generated placeholders.
