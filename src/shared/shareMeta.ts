// The dynamic link preview (owner ask 2026-07-16): a shared invite URL
// carries ?need=<score still wanted>&hoop=<the tier it unlocks>, stamped
// at the moment the player pressed SHARE. Whatever serves index.html
// rewrites the static og:description with that progress, so the pasted
// link previews as "Come and Shoot Some Hoop! Only 450 score till Hoop 3!".
//
// Dependency-free on purpose - the vite dev plugin uses it today and a
// production HTTP layer (none exists yet) must reuse it verbatim.

const DESCRIPTION_TAG =
  /(<meta\s+property="og:description"\s+content=")[^"]*(")/;

/** Cap against a doctored link inflating the preview into nonsense. */
const MAX_PREVIEW_NUM = 1_000_000;

function previewNum(raw: string | null): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < MAX_PREVIEW_NUM ? n : null;
}

/**
 * Rewrite the og:description in `html` from the request's query string.
 * Untouched when need/hoop are absent or not sane positive integers.
 */
export function injectShareMeta(html: string, search: string): string {
  const params = new URLSearchParams(search);
  const need = previewNum(params.get("need"));
  const hoop = previewNum(params.get("hoop"));
  if (need === null || hoop === null) return html;
  return html.replace(
    DESCRIPTION_TAG,
    `$1Come and Shoot Some Hoop! Only ${need} score till Hoop ${hoop}!$2`,
  );
}
