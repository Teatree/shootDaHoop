import { describe, expect, it } from "vitest";
import {
  buildInvite,
  buildLobbyUrl,
  courtName,
  generateLobbyId,
} from "./lobbyLink";
import { safe } from "../../server/storage";

// Invite links: the id must survive the server's filename sanitizer
// unchanged, and the URL must never smuggle ?reset / ?pid to a friend.

describe("generateLobbyId", () => {
  it("mints adjective-noun-hhhh ids", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateLobbyId()).toMatch(/^[a-z]+-[a-z]+-[0-9a-f]{4}$/);
    }
  });

  it("passes the storage filename sanitizer unchanged", () => {
    for (let i = 0; i < 50; i++) {
      const id = generateLobbyId();
      expect(safe(id)).toBe(id);
    }
  });

  it("uses the injected rand deterministically", () => {
    expect(generateLobbyId(() => 0)).toBe("mossy-fox-0000");
  });
});

describe("buildLobbyUrl", () => {
  it("builds origin + path + ?lobby=", () => {
    expect(buildLobbyUrl("http://host:5173", "/", "", "mossy-fox-3f2a")).toBe(
      "http://host:5173/?lobby=mossy-fox-3f2a",
    );
  });

  it("carries ?server= over (custom-server sessions keep working)", () => {
    expect(
      buildLobbyUrl("http://h", "/", "?server=ws%3A%2F%2Fgs%3A9999", "a-b-c"),
    ).toBe("http://h/?lobby=a-b-c&server=ws%3A%2F%2Fgs%3A9999");
  });

  it("drops ?reset, ?pid and the current ?lobby", () => {
    const url = buildLobbyUrl(
      "http://h",
      "/",
      "?lobby=old&pid=alice&reset=1",
      "new-court-0000",
    );
    expect(url).toBe("http://h/?lobby=new-court-0000");
  });
});

describe("courtName", () => {
  it("drops the hex tail and reads as words", () => {
    expect(courtName("velvet-vulture-83d0")).toBe("velvet vulture");
  });

  it("leaves ids without a hex tail intact", () => {
    expect(courtName("test-court")).toBe("test court");
  });
});

describe("buildInvite", () => {
  const url = "http://h/?lobby=velvet-vulture-83d0";
  const invite = buildInvite("velvet-vulture-83d0", url);

  it("names the court and carries the URL on its own line", () => {
    expect(invite).toContain("the velvet vulture court");
    expect(invite.split("\n")).toContain(`▶ ${url}`);
  });

  it("is framed top and bottom", () => {
    const lines = invite.split("\n");
    expect(lines[0]).toMatch(/^🏀━+🏀$/);
    expect(lines[3]).toBe(lines[0]);
  });
});
