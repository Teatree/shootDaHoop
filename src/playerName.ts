// Player identity: asked via a DOM overlay, then remembered in
// localStorage. OFFLINE the name is global to the browser; in a LOBBY the
// name is per-lobby (asked again the first time you enter each lobby, then
// fixed for that lobby — main.ts passes the per-lobby storage key). The
// name shows above the character and in every court-wall log line.

const NAME_KEY = "shootDaHoop.playerName";
const MAX_LEN = 16;

export function getStoredName(storageKey: string = NAME_KEY): string | null {
  const raw = localStorage.getItem(storageKey);
  const name = raw?.trim().slice(0, MAX_LEN);
  return name ? name : null;
}

/** Full-viewport overlay asking for a name; resolves once confirmed. */
export function askPlayerName(storageKey: string = NAME_KEY): Promise<string> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = "name-overlay";
    overlay.innerHTML = `
      <div id="name-card">
        <div id="name-title">Welcome to the court</div>
        <div id="name-sub">What do they call you?</div>
        <input id="name-input" type="text" maxlength="${MAX_LEN}"
               autocomplete="off" spellcheck="false" placeholder="Your name…" />
        <button id="name-play">Play</button>
      </div>`;
    document.body.appendChild(overlay);

    const input = overlay.querySelector<HTMLInputElement>("#name-input")!;
    const play = overlay.querySelector<HTMLButtonElement>("#name-play")!;
    input.focus();

    const confirm = () => {
      const name = input.value.trim().slice(0, MAX_LEN) || "Player";
      localStorage.setItem(storageKey, name);
      overlay.remove();
      resolve(name);
    };
    play.addEventListener("click", confirm);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") confirm();
      e.stopPropagation(); // keep Enter from also opening the chat box
    });
  });
}
