# Mobile - how shootDaHoop runs on phones

Built 2026-07-17, adapted from the Roombov share-out (`mobile-approach.md`
in the repo root - kept verbatim as the source material). Same principle:
ONE responsive browser build, no separate bundle, landscape-only, and
every mobile behavior a strict no-op on desktop.

## The gate (src/mobile.ts)

`isMobileDevice()` - computed once, cached for the session:

1. `?mobile=1` / `?mobile=0` URL override first. This is how Playwright
   runs "mobile" on a desktop browser and how a touch-laptop player can
   force the PC path.
2. Auto-detection requires BOTH touch capability
   (`maxTouchPoints > 0 || 'ontouchstart' in window`) AND a coarse
   primary pointer (`matchMedia('(pointer: coarse)')`). Touch alone
   misclassifies mouse-first touchscreen laptops.
3. `__setMobileForTest()` for unit tests.

DOM styling is gated by a `body.mobile` class (set in `installMobile`),
NOT media queries - the class obeys the URL override, media queries
never could. The whole mobile CSS lives at the end of `style.css` under
`body.mobile` selectors; desktop rendering is untouched by the section.

## Viewport + landscape (installMobile)

- Phaser stays in `Scale.RESIZE`. One rAF-coalesced handler listens to
  `visualViewport` resize + scroll (plus `window.resize` /
  `orientationchange` fallbacks): it reads `visualViewport.width/height`
  (the only honest visible size when the URL bar or keyboard move),
  pins `#app` to those exact pixels, forces a reflow, and calls
  `game.scale.refresh()` - twice, the second on the next frame.
  NEVER `scale.resize(w, h)` here: in RESIZE mode an explicit resize
  applies ONE EVENT LATE, so closing the keyboard left the game at the
  keyboard-open size with the camera zoomed way out (the 2026-07-18
  keyboard bug); and a single same-frame refresh() updates Phaser's
  parentSize without reliably propagating to the game size - the
  next-frame refresh is the one that always sticks (idempotent when
  the first already did). `100dvh` in the CSS is the no-JS baseline.
  `scrollTo(0,0)` on the scroll pass undoes iOS's focused-input pan.
- Portrait = `h > w`, derived in the same handler - one source of truth.
  While portrait, a DOM overlay (`#portrait-gate`, injected style,
  rotating phone outline, "Rotate your phone to play 🏀") covers
  everything and canvas resizes are SKIPPED; rotating back hides it and
  the next pass resizes. Nothing is torn down.
- The viewport meta carries `interactive-widget=resizes-content`:
  Android Chrome then shrinks the layout when the keyboard opens, so
  the same handler re-pins and the chat input stays visible above the
  keyboard. iOS ignores the attribute and shrinks the visual viewport,
  which is exactly what the handler reads anyway. This is the
  keyboard-drawer defense: open, type, dismiss - the layout re-pins
  itself each way and the game never scrolls out from under the player.

## Touch controls (src/aiming.ts)

The touch layer only decides WHEN the existing hooks fire -
`begin/release/cancel/computeShot` and the walk path are the desktop
code, unforked.

| Gesture | Result |
| --- | --- |
| Tap bare floor | walk there (desktop left-click body, shared `handleWalkPress`) |
| Tap an interactive (upgrade button, jukebox) | its own handler (`over.length` guard) |
| Press INSIDE the character's ring | aim begins (out of balls: the point/punch pose instead) |
| Drag out | charge - same drag-distance power mapping as desktop |
| Release outside the ring | throw (`computeShot`; sub-deadzone drags = no throw) |
| Drag back INSIDE the ring, release | cancel - no throw |
| Finger slides off the canvas | `pointerupoutside` lands the release anyway |
| Second finger mid-aim | ignored (`aimPointerId` owns the aim) |
| Ring press while cheering | leaves the cheer spot (the right-click analogue) |

The ring (`playerRing` / `playerRingHit`, knobs in `T.aim.ring`): the
figure's 54 x 64 px box + 10% (owner spec), as an ellipse centered on
the body, floored to a 36 px SCREEN radius so camera zoom-out never
shrinks it under a fingertip. While aiming the exact hit ellipse is
stroked into the preview - dim while armed, brighter when the finger is
back inside (release here = cancel). What you see IS the hit test.

## HUD reflow (body.mobile + hud.ts)

- The 70/30 game/wall split stays.
- Chat moves to the BOTTOM OF THE WALL: `hud.ts` re-parents
  `#chat-wrap` into `#log-panel` (same nodes, listeners survive),
  placeholder "Tap to chat", input restyled for dark brick, emoji
  picker hidden (native keyboards have emoji).
- Ball row: 30 px slots at the corner, hint 22 px; the hint tooltip
  opens on TAP (`.open` class) and closes on any outside tap - hover
  does not exist on touch.
- The tutorial pop-up is skipped entirely on mobile for now (its videos
  teach mouse controls); the join connects immediately. A touch
  tutorial is a follow-up.
- Gesture hygiene: `overscroll-behavior: none`, `touch-action: none` on
  the game viewport, `manipulation` on buttons.

## Testing recipe

- `?mobile=1` at a landscape viewport (e.g. 900x420) turns the whole
  layer on in desktop Playwright. `?mobile=0` is the desktop-regression
  control on real devices.
- Phaser 3 listens to MOUSE/TOUCH events, NOT PointerEvents - synthetic
  gesture tests must dispatch `MouseEvent`/`TouchEvent` on the canvas.
  The mobile input branches don't care about buttons, so plain
  `mousedown/mousemove/mouseup` drives the ring-drag in tests.
- Portrait gate: resize the window taller than wide - the overlay shows
  and the canvas resize is skipped (its size stays stale on purpose);
  resize back - it hides and the canvas re-fits.
- The keyboard drawer needs a MANUAL device pass (iOS Safari + Android
  Chrome): focus chat, keyboard up - input stays visible, canvas
  resized; dismiss - restored; rotate with the keyboard open.

## Follow-ups (deliberate cuts)

- No touch tutorial yet (the pop-up is simply skipped).
- No pinch zoom / camera control - the CameraRig stays autonomous.
- The wall keeps 30% width on phones (~220 px); revisit if it reads
  cramped on small devices.
