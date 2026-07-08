// Player identity: asked once via a DOM overlay on first visit, then
// remembered in localStorage. The name shows above the character and in
// every court-wall log line.

const NAME_KEY = "shootDaHoop.playerName";
const MAX_LEN = 16;

export function getStoredName(): string | null {
  const raw = localStorage.getItem(NAME_KEY);
  const name = raw?.trim().slice(0, MAX_LEN);
  return name ? name : null;
}

/** Full-viewport overlay asking for a name; resolves once confirmed. */
export function askPlayerName(): Promise<string> {
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
      localStorage.setItem(NAME_KEY, name);
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
