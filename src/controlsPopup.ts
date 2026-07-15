// The first-entry CONTROLS pop-up (owner ask 2026-07-15): two looping
// videos side by side — Walking, then Throwing — each with an animated
// mouse underneath. Under the walk video the mouse plays a plain LEFT
// CLICK on a loop; under the throw video it plays a CLICK-AND-HOLD.
//
// A player sees this exactly ONCE per browser (localStorage flag), and
// their character does not enter the court — for them OR for anyone
// else — until they press the ✕: the caller keeps backend.connect()
// behind onClose, so the join (and the spawn broadcast) simply hasn't
// happened yet. Only the ✕ closes it; outside clicks and Escape don't.

const SEEN_KEY = "shootDaHoop.controlsSeen";

/** True when this browser has never seen the controls pop-up. */
export function shouldShowControls(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === null;
  } catch {
    return true; // storage blocked → show it (can't remember anyway)
  }
}

/** One animated mouse: body + left button (the part that animates). */
function mouseHtml(kind: "click" | "hold"): string {
  return `
    <div class="tut-mouse tut-mouse-${kind}">
      <div class="tut-mouse-left"></div>
      <div class="tut-mouse-wheel"></div>
    </div>`;
}

export function showControlsPopup(onClose: () => void): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // storage blocked — the pop-up will simply show again next time
  }
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
