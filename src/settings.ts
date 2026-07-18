import { reportEvent } from "./analytics";
import {
  buildInvite,
  buildLobbyUrl,
  generateLobbyId,
} from "./shared/lobbyLink";

// The ⚙️ Settings pop-up (gear button beside Send) and the shared modal
// builder. Today Settings holds one thing: "Generate lobby link" - mint
// an invite URL for a FRESH court. The link is inert until a friend
// opens it and enters a name; that first join is what creates the lobby
// on the server (worlds are made on demand, see server/index.ts).

/** Wire the gear button. Call once at boot; works offline too. */
export function initSettings(): void {
  const btn = document.querySelector<HTMLButtonElement>("#settings-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    btn.blur(); // Space/Enter must go back to the game, not re-open this
    openSettings();
  });
}

function openSettings(): void {
  const overlay = buildOverlay(`
    <div class="modal-title">Settings</div>
    <div class="modal-sub">Start a new court and invite friends to it.</div>
    <label class="modal-row modal-slider-row" for="gen-players">
      <span>Expected players:</span>
      <input type="range" id="gen-players" min="2" max="5" step="1" value="3" />
      <span id="gen-players-val" class="modal-slider-val">3</span>
    </label>
    <button class="modal-btn" id="gen-link">Generate lobby link</button>
    <div id="gen-result" hidden>
      <input class="modal-url-input" id="gen-url" type="text" readonly />
      <div class="modal-row">
        <button class="modal-btn" id="gen-copy">Copy invite</button>
        <button class="modal-btn" id="gen-join">Join this lobby</button>
      </div>
    </div>
    <button class="modal-btn modal-btn-quiet" id="settings-close">Close</button>
  `);

  const q = <T extends HTMLElement>(sel: string) =>
    overlay.querySelector<T>(sel)!;
  const result = q<HTMLDivElement>("#gen-result");
  const urlInput = q<HTMLInputElement>("#gen-url");
  const copyBtn = q<HTMLButtonElement>("#gen-copy");

  const close = () => overlay.remove();
  q("#settings-close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    e.stopPropagation(); // keep keys from reaching the game/chat
  });

  // the court-size slider (2-5): the new lobby's hoop thresholds scale
  // for this crowd - captured by the server at the world's creation
  const playersInput = q<HTMLInputElement>("#gen-players");
  const playersVal = q<HTMLSpanElement>("#gen-players-val");
  playersInput.addEventListener("input", () => {
    playersVal.textContent = playersInput.value;
  });

  // the pop-up shows the bare URL; the clipboard gets the stylized
  // invitation poster (the link rides along inside it)
  let invite = "";
  q("#gen-link").addEventListener("click", () => {
    const lobbyId = generateLobbyId();
    const players = playersInput.value;
    urlInput.value = buildLobbyUrl(
      location.origin,
      location.pathname,
      location.search,
      lobbyId,
      // the default stays off the link - baseline courts keep clean URLs
      players !== "3" ? { players } : undefined,
    );
    invite = buildInvite(urlInput.value);
    reportEvent("invite_generated", `${lobbyId} (${players}p)`);
    result.hidden = false;
    copyBtn.textContent = "Copy invite";
    urlInput.select();
  });

  copyBtn.addEventListener("click", () => {
    void copyText(invite, urlInput).then((ok) => {
      copyBtn.textContent = ok ? "Copied!" : "Press Ctrl+C";
      setTimeout(() => (copyBtn.textContent = "Copy invite"), 1500);
    });
  });

  q("#gen-join").addEventListener("click", () => {
    if (urlInput.value) location.href = urlInput.value;
  });
}

/**
 * Blocking notice (no outside-click close) - e.g. "this lobby was
 * removed by the admin". The single button navigates away.
 */
export function showNotice(
  title: string,
  sub: string,
  action: { label: string; href: string },
): void {
  const overlay = buildOverlay(`
    <div class="modal-title">${title}</div>
    <div class="modal-sub">${sub}</div>
    <button class="modal-btn" id="notice-action">${action.label}</button>
  `);
  overlay
    .querySelector("#notice-action")!
    .addEventListener("click", () => (location.href = action.href));
}

function buildOverlay(cardHtml: string): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal-card">${cardHtml}</div>`;
  document.body.appendChild(overlay);
  return overlay;
}

/**
 * Clipboard API first; a throwaway textarea + execCommand keeps
 * plain-HTTP LAN testing working (the visible input only holds the bare
 * URL, so it can't stand in for the multi-line invite). If everything
 * fails, the fallback input (when given) stays selected - Ctrl+C at
 * least shares the link. Exported: the share button reuses it.
 */
export async function copyText(
  text: string,
  fallback?: HTMLInputElement,
): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    if (!ok) fallback?.select();
    return ok;
  }
}
