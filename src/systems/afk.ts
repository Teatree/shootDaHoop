// AFK detection, client-side: a player is "away" when no pointer or key
// input has arrived for a while. Used for the upgrade catch-up replay -
// a returning AFK player sees roughly the same success animation the
// triggering player saw (HOOP_PROGRESSION.md).
//
// Note the freebie: Phaser pauses its whole clock when the tab blurs, so
// a HIDDEN tab already holds the choreography and plays it on focus.
// IdleWatch covers the other case - the tab visible but nobody home.

export class IdleWatch {
  private lastActivityMs = Date.now();
  private wasAfk = false;

  constructor(
    /** seconds of silence before the player counts as AFK */
    private readonly timeoutS: number,
    /** fired on the first input AFTER an AFK stretch - the "return" */
    private readonly onReturn: () => void,
  ) {
    const poke = () => this.poke();
    window.addEventListener("pointermove", poke, { passive: true });
    window.addEventListener("pointerdown", poke, { passive: true });
    window.addEventListener("keydown", poke);
  }

  get isAfk(): boolean {
    return (Date.now() - this.lastActivityMs) / 1000 > this.timeoutS;
  }

  private poke() {
    const returning = this.isAfk || this.wasAfk;
    this.lastActivityMs = Date.now();
    if (returning) {
      this.wasAfk = false;
      this.onReturn();
    }
  }

  /** Called each frame so a mid-frame AFK flip is latched for poke(). */
  update() {
    if (this.isAfk) this.wasAfk = true;
  }
}
