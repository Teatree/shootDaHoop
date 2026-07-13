// Lobby invite links, minted client-side in the Settings pop-up. A
// generated link is JUST a link — no server call here. The lobby comes
// into existence the moment the first visitor opens it and enters a
// name (the server creates worlds on demand, keyed by ?lobby=).
// Dependency-free so both the UI and vitest can import it.

const ADJECTIVES = [
  "mossy", "dusty", "sunny", "rusty", "windy", "sandy", "misty", "lucky",
  "loud", "quiet", "wild", "lazy", "swift", "spicy", "salty", "shiny",
  "foggy", "rainy", "golden", "velvet", "neon", "cosmic", "retro", "midnight",
];

const NOUNS = [
  "fox", "hawk", "rim", "net", "court", "alley", "comet", "cactus",
  "pigeon", "lizard", "brick", "swish", "dunk", "bounce", "arc", "moon",
  "canyon", "mirage", "coyote", "boombox", "sneaker", "asphalt", "vulture", "dune",
];

/**
 * `adjective-noun-hhhh`, e.g. "mossy-fox-3f2a". Lowercase [a-z0-9-]
 * throughout, so it survives the server's filename sanitizer unchanged
 * and needs no URL encoding. ~37M combinations — a collision just means
 * two groups share a court, same as sharing a link on purpose.
 */
export function generateLobbyId(
  rand: (maxExclusive: number) => number = cryptoRand,
): string {
  const adj = ADJECTIVES[rand(ADJECTIVES.length)];
  const noun = NOUNS[rand(NOUNS.length)];
  const hex = Array.from({ length: 4 }, () => rand(16).toString(16)).join("");
  return `${adj}-${noun}-${hex}`;
}

/**
 * The invite URL. Deliberately keeps ONLY ?server= from the current
 * address: a leaked ?reset would wipe the new lobby's score on every
 * open, and a shared ?pid would merge the friends into one identity.
 */
export function buildLobbyUrl(
  origin: string,
  pathname: string,
  search: string,
  lobbyId: string,
): string {
  const out = new URLSearchParams({ lobby: lobbyId });
  const server = new URLSearchParams(search).get("server");
  if (server) out.set("server", server);
  return `${origin}${pathname}?${out.toString()}`;
}

/** "velvet-vulture-83d0" → "velvet vulture" — the hex tail is plumbing. */
export function courtName(lobbyId: string): string {
  return lobbyId.replace(/-[0-9a-f]{4}$/, "").replace(/-/g, " ");
}

/**
 * The share piece the Copy button puts on the clipboard: a framed
 * plain-text poster that reads well pasted into Discord/Slack/WhatsApp.
 * The pop-up still DISPLAYS the bare URL; this is what travels.
 */
export function buildInvite(lobbyId: string, url: string): string {
  const frame = `🏀${"━".repeat(22)}🏀`;
  return [
    frame,
    center("PICK-UP  GAME"),
    center(`the ${courtName(lobbyId)} court`),
    frame,
    "",
    "The court is open and the rim is",
    "calling — come shoot a hoop.",
    "",
    `▶ ${url}`,
  ].join("\n");
}

/** Rough centering against the frame (two emoji ≈ four columns wide). */
function center(s: string): string {
  return " ".repeat(Math.max(0, Math.floor((26 - s.length) / 2))) + s;
}

function cryptoRand(maxExclusive: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % maxExclusive;
}
