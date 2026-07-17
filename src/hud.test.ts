import { describe, expect, it } from "vitest";
import { esc, linkify } from "./hud";

// Chat rendering: URLs become anchors; GIPHY urls become the animated
// gif itself (owner 2026-07-18), with ONLY the extracted id reaching
// the img src - the raw URL can never smuggle markup past esc().

describe("linkify", () => {
  it("wraps plain URLs in anchors, text untouched", () => {
    const out = linkify(esc("see https://example.com/x?a=1 now"));
    expect(out).toContain('<a href="https://example.com/x?a=1"');
    expect(out).toContain(">https://example.com/x?a=1</a>");
  });

  it("renders a giphy PAGE link as the gif, inside the anchor", () => {
    const out = linkify(
      esc("lol https://giphy.com/gifs/funny-cat-dunk-3o7aCSPqXE5C6T8tBC"),
    );
    expect(out).toContain(
      'src="https://media.giphy.com/media/3o7aCSPqXE5C6T8tBC/giphy.gif"',
    );
    expect(out).toContain('class="chat-gif"');
    expect(out).toContain('<a href="https://giphy.com/gifs/funny-cat-dunk-3o7aCSPqXE5C6T8tBC"');
  });

  it("renders a media.giphy.com URL as the gif", () => {
    const out = linkify(
      esc("https://media.giphy.com/media/3o7aCSPqXE5C6T8tBC/giphy.gif"),
    );
    expect(out).toContain(
      'src="https://media.giphy.com/media/3o7aCSPqXE5C6T8tBC/giphy.gif"',
    );
  });

  it("a non-giphy gif URL stays a plain anchor", () => {
    const out = linkify(esc("https://example.com/media/abc12345/giphy.gif"));
    expect(out).not.toContain("chat-gif");
  });

  it("escaped markup around the link never survives", () => {
    const out = linkify(esc('<img x> https://giphy.com/gifs/abc123456789'));
    expect(out).toContain("&lt;img x&gt;");
    expect(out.match(/<img/g)?.length).toBe(1); // only OUR gif embed
  });
});
