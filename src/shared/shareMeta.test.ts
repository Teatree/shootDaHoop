import { describe, expect, it } from "vitest";
import { injectShareMeta } from "./shareMeta";

// The link-preview rewrite: a shared URL's ?need=&hoop= must land in the
// og:description, and a doctored link must not.

const HTML = `<head>
    <meta
      property="og:title"
      content="shootDaHoop - Your daily provider of Hoop related activities"
    />
    <meta property="og:description" content="Come and Shoot Some Hoop!" />
  </head>`;

describe("injectShareMeta", () => {
  it("rewrites the description from need/hoop", () => {
    const out = injectShareMeta(HTML, "lobby=a-b-c&need=450&hoop=3");
    expect(out).toContain(
      'content="Come and Shoot Some Hoop! Only 450 score till Hoop 3!"',
    );
    expect(out).not.toContain('content="Come and Shoot Some Hoop!"');
  });

  it("leaves the static description without the params", () => {
    expect(injectShareMeta(HTML, "lobby=a-b-c")).toBe(HTML);
    expect(injectShareMeta(HTML, "")).toBe(HTML);
  });

  it("rejects doctored values (negative, huge, non-numeric)", () => {
    for (const q of [
      "need=-5&hoop=3",
      "need=999999999&hoop=3",
      "need=abc&hoop=3",
      "need=450&hoop=2.5",
    ])
      expect(injectShareMeta(HTML, q)).toBe(HTML);
  });

  it("never touches the title", () => {
    const out = injectShareMeta(HTML, "need=1&hoop=2");
    expect(out).toContain("Your daily provider of Hoop related activities");
  });
});
