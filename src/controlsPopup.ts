// The first-entry CONTROLS pop-up (owner ask 2026-07-15): two looping
// videos side by side - Walking, then Throwing - each with an animated
// mouse underneath. Under the walk video the mouse plays a plain LEFT
// CLICK on a loop; under the throw video it plays a CLICK-AND-HOLD.
//
// It appears right AFTER the name modal, and only then: main.ts flags a
// boot where the player had to CHOOSE a name (no stored one = a first
// entry into this court) and the scene shows the pop-up on that flag -
// the stored name itself is the "seen it" persistence, so there is no
// separate flag to go stale (owner bug 2026-07-16: a localStorage
// seen-flag got consumed by a page load the owner never looked at).
//
// Until the player presses the ✕ their character exists for NOBODY:
// the caller keeps backend.connect() behind onClose, so the join (and
// the spawn broadcast) simply hasn't happened yet. Only the ✕ closes
// it; outside clicks and Escape don't.

/** One animated mouse: body + left button (the part that animates). */
function mouseHtml(kind: "click" | "hold"): string {
  return `
    <div class="tut-mouse tut-mouse-${kind}">
      <div class="tut-mouse-left"></div>
      <div class="tut-mouse-wheel"></div>
    </div>`;
}

export function showControlsPopup(onClose: () => void): void {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card controls-card">
      <button id="controls-close" type="button" title="Close">✕</button>
      <div class="controls-cols">
        <div class="controls-col">
          <video src="assets/tutorial/tut_walk.webm" autoplay loop muted playsinline></video>
          ${mouseHtml("click")}
        </div>
        <div class="controls-col">
          <video src="assets/tutorial/tut_throw.webm" autoplay loop muted playsinline></video>
          ${mouseHtml("hold")}
        </div>
      </div>
    </div>`;
  // keep keys from reaching the game while the pop-up is up
  overlay.addEventListener("keydown", (e) => e.stopPropagation());
  document.body.appendChild(overlay);
  overlay.querySelector("#controls-close")!.addEventListener("click", () => {
    overlay.remove();
    onClose();
  });
}
