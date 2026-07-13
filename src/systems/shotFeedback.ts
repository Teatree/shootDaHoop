import Phaser from "phaser";
import { T } from "../tuning";
import { esc, type HUD } from "../hud";
import { burst, flash, floatText, netSnap } from "../juice";
import { playSfx } from "../sfx";
import type { HoopParts } from "../placeholders";
import type { ShotOutcome } from "../ball";

// Everything the player sees/hears when a shot resolves: hoop juice,
// float text, camera shake, sfx, and the attributed court-wall log line.
// Big shots (per-shot pts > score.bigScorePts) get the rainbow treatment.

export interface FeedbackCtx {
  scene: Phaser.Scene;
  hud: HUD;
  hoop: HoopParts;
  who: string; // player name (raw; escaped here)
}

export function presentScore(
  ctx: FeedbackCtx,
  o: ShotOutcome,
  pts: number,
  slam: boolean,
  onReplay?: () => void,
) {
  const big = pts > T.score.bigScorePts;
  const j = T.juice;
  const { scene, hoop } = ctx;
  const { rimSX, rimSY } = hoop.primary;

  // a double shot snapped BOTH nets on its way down
  for (const rim of o.rims >= 2 ? hoop.rims : [hoop.primary])
    netSnap(scene, rim.net);
  flash(scene, rimSX, rimSY, big ? j.big.flashRadius : o.swish ? 34 : 24);
  const baseParticles = o.swish ? j.swishParticles : j.scoreParticles;
  burst(
    scene,
    rimSX,
    rimSY + 6,
    Math.round(baseParticles * (big ? j.big.particleMult : 1)),
  );
  scene.cameras.main.shake(
    big ? j.big.shakeMs : o.swish ? j.swishShakeMs : j.scoreShakeMs,
    big
      ? j.big.shakeIntensity
      : o.swish
        ? j.swishShakeIntensity
        : j.scoreShakeIntensity,
  );
  floatText(
    scene,
    rimSX,
    rimSY - 26,
    slam ? `TELEPORT SLAM! +${pts}` : o.swish ? `SWISH! +${pts}` : `+${pts}`,
    big ? j.big.floatColor : o.swish ? "#ffb84d" : "#ffd97a",
    big ? j.big.floatSizePx : o.swish ? 22 : 18,
  );
  playSfx(scene, o.swish ? "sfx_swish" : "sfx_score", 1);

  const d = o.distM.toFixed(1);
  const who = esc(ctx.who);
  // big lines are plain text — the rainbow gradient owns the whole line
  ctx.hud.log(
    "throw",
    slam
      ? `${who} — ${d}m teleport slam! ${o.swish ? "SWISH! " : ""}+${pts}`
      : big
        ? `${who} — ${d}m ${o.swish ? "SWISH! " : ""}+${pts}`
        : o.swish
          ? `${who} — ${d}m <span class="swish">SWISH!</span> <span class="pts">+${pts}</span>`
          : `${who} — ${d}m hit <span class="pts">+${pts}</span>`,
    big ? "bigscore" : undefined,
    onReplay,
  );
}

export function presentMiss(
  ctx: FeedbackCtx,
  o: ShotOutcome,
  slam: boolean,
  onReplay?: () => void,
) {
  ctx.hud.log(
    "throw",
    slam
      ? `${esc(ctx.who)} — teleport slam failed!`
      : `${esc(ctx.who)} — ${o.distM.toFixed(1)}m miss`,
    "miss", // the wall's filter dropdown can hide miss lines
    onReplay,
  );
}

/** The ghost replay's made-basket moment: snap the real net, small flash. */
export function replayMadeEffect(scene: Phaser.Scene, hoop: HoopParts) {
  netSnap(scene, hoop.primary.net);
  flash(scene, hoop.primary.rimSX, hoop.primary.rimSY, 18);
}
