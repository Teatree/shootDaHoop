import type Phaser from "phaser";

// The mobile layer (docs/mobile.md, adapted from mobile-approach.md):
// ONE gate, one viewport handler, one portrait overlay. Everything
// mobile hangs off isMobileDevice(); when it returns false the whole
// module is a strict no-op and the desktop build is byte-identical.
//
//  - ?mobile=1 / ?mobile=0 overrides detection (testing on desktop,
//    force-off on touch laptops)
//  - auto-detection needs BOTH touch capability AND a coarse primary
//    pointer - touch alone misclassifies touchscreen laptops
//  - visualViewport is the only honest source of visible size when the
//    URL bar / keyboard move; we pin #app to it and let Phaser's
//    Scale.RESIZE follow the #game-wrap that results
//  - the game is landscape-only: portrait shows a DOM overlay and the
//    canvas resize is skipped until the device rotates back

let cached: boolean | null = null;

export function isMobileDevice(): boolean {
  if (cached !== null) return cached;
  const override = new URLSearchParams(location.search).get("mobile");
  if (override === "1") return (cached = true);
  if (override === "0") return (cached = false);
  const touch = navigator.maxTouchPoints > 0 || "ontouchstart" in window;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  return (cached = touch && coarse);
}

/** Tests only - force the gate without a URL. */
export function __setMobileForTest(v: boolean | null) {
  cached = v;
}

/** Install the whole mobile layer. Call once, right after the Phaser
 *  game is constructed. No-op on desktop. */
export function installMobile(game: Phaser.Game): void {
  if (!isMobileDevice()) return;
  document.body.classList.add("mobile");

  const gate = buildPortraitGate();
  const app = document.getElementById("app")!;
  const wrap = document.getElementById("game-wrap")!;

  // rAF-coalesced: a burst of viewport events = at most one pass/frame
  let queued = false;
  const pass = () => {
    queued = false;
    const vv = window.visualViewport;
    const w = Math.round(vv?.width ?? window.innerWidth);
    const h = Math.round(vv?.height ?? window.innerHeight);
    const portrait = h > w;
    gate.classList.toggle("show", portrait);
    // no point reflowing the game behind an opaque cover - and it saves
    // the portrait->landscape double resize
    if (portrait) return;
    app.style.width = `${w}px`;
    app.style.height = `${h}px`;
    // let RESIZE mode re-measure the freshly pinned parent. An explicit
    // scale.resize(w, h) here applies ONE EVENT LATE (verified: the
    // keyboard-close pass landed the keyboard-open size, leaving the
    // camera zoomed out until the next resize - the reported mobile
    // keyboard bug). refresh() measures now - and AGAIN next frame,
    // because a refresh in the same frame as the pin updates Phaser's
    // parentSize without always propagating to the game size (verified
    // empirically; the second pass is idempotent when the first stuck).
    void wrap.clientWidth; // force the reflow before Phaser measures
    game.scale.refresh();
    requestAnimationFrame(() => game.scale.refresh());
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(pass);
  };

  window.visualViewport?.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("scroll", () => {
    // iOS pans the layout viewport to reveal a focused input - the game
    // must stay pinned at the origin
    window.scrollTo(0, 0);
    schedule();
  });
  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", schedule);
  pass(); // the page may load while already portrait
}

/** The rotate-your-phone cover: pure DOM + injected style, so it works
 *  before the first scene renders and over every scene equally. */
function buildPortraitGate(): HTMLDivElement {
  const style = document.createElement("style");
  style.textContent = `
    #portrait-gate {
      position: fixed;
      inset: 0;
      z-index: 99999;
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 18px;
      background: #1d1712;
      color: #fff3d6;
      font-family: "Courier New", Courier, monospace;
      font-weight: bold;
      font-size: 18px;
      text-align: center;
    }
    #portrait-gate.show { display: flex; }
    #portrait-gate .phone {
      width: 34px;
      height: 58px;
      border: 3px solid #e8b878;
      border-radius: 6px;
      animation: gate-rotate 1.6s ease-in-out infinite;
    }
    @keyframes gate-rotate {
      0%, 25% { transform: rotate(0deg); }
      60%, 100% { transform: rotate(-90deg); }
    }
  `;
  document.head.appendChild(style);

  const gate = document.createElement("div");
  gate.id = "portrait-gate";
  gate.innerHTML = `<div class="phone"></div><div>Rotate your phone to play 🏀</div>`;
  document.body.appendChild(gate);
  return gate;
}
