import { afterEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { Room } from "./room";
import type {
  ArchivedEntry,
  PlayerProfile,
  Storage,
  WorldBundle,
} from "./storage";
import type { ServerMsg } from "../src/shared/messages";
import { BALANCE } from "../src/shared/config";
import { RIM } from "../src/shared/court";
import { HOOP_TIERS } from "../src/shared/tiers";

// The upgrade is a SERVER-AUTHORITATIVE, communal event: any player may
// press, but the server owns the rules — threshold met, presser at the
// button — and the reset + teleport-clear + broadcast that follow.

class FakeWS {
  OPEN = 1;
  readyState = 1;
  sent: ServerMsg[] = [];
  send(data: string) {
    this.sent.push(JSON.parse(data) as ServerMsg);
  }
  close() {
    this.readyState = 3;
  }
  of(t: ServerMsg["t"]) {
    return this.sent.filter((m) => m.t === t);
  }
}

class MemStorage implements Storage {
  worlds = new Map<string, WorldBundle>();
  profiles = new Map<string, PlayerProfile>();
  logs: ArchivedEntry[] = [];
  async loadWorld(lobby: string) {
    return this.worlds.get(lobby) ?? null;
  }
  async saveWorld(bundle: WorldBundle) {
    this.worlds.set(bundle.lobby, bundle);
  }
  async loadProfile(id: string) {
    return this.profiles.get(id) ?? null;
  }
  async saveProfile(profile: PlayerProfile) {
    this.profiles.set(profile.id, profile);
  }
  async appendLog(_lobby: string, entry: ArchivedEntry) {
    this.logs.push(entry);
  }
}

const identity = (id: string) => ({
  id,
  name: id,
  shirtColor: 0xffffff,
  skinTint: 0xffffff,
  lowerTint: 0xffffff,
  headVariant: 1,
});

const BUTTON = { x: RIM.x - BALANCE.move.hoopStandoffM, d: RIM.d };
const T2 = HOOP_TIERS[1];

let room: Room | null = null;

async function makeRoom(sharedScore: number, tierId = 1) {
  const storage = new MemStorage();
  storage.worlds.set("test", {
    lobby: "test",
    world: { sharedScore, tierId },
    history: [],
  });
  room = new Room("test", storage, () => {});
  return { room, storage };
}

afterEach(() => {
  room?.destroy(); // clears orb + snapshot timers
  room = null;
});

describe("the upgrade press", () => {
  it("resets the score, advances the tier, and teleports everyone clear", async () => {
    const { room, storage } = await makeRoom(T2.threshold);
    const a = new FakeWS();
    const b = new FakeWS();
    await room.join(a as unknown as WebSocket, identity("alice"));
    await room.join(b as unknown as WebSocket, identity("bob"));

    // alice walks to the button and presses
    room.handle("alice", { t: "move-to", x: BUTTON.x, d: BUTTON.d });
    room.handle("alice", { t: "upgrade" });

    for (const ws of [a, b]) {
      const [up] = ws.of("upgraded");
      expect(up).toBeDefined();
      if (up?.t !== "upgraded") throw new Error("unreachable");
      expect(up.tierId).toBe(2);
      expect(up.byName).toBe("alice");
      // the next tier counts fresh from zero
      expect(up.world).toEqual({ sharedScore: 0, tierId: 2 });
      // every active player lands in the clear band, on the court
      expect(up.placements.map((p) => p.id).sort()).toEqual(["alice", "bob"]);
      for (const p of up.placements) {
        expect(p.x).toBeGreaterThanOrEqual(BALANCE.upgrade.clearMinXM);
        expect(p.x).toBeLessThanOrEqual(BALANCE.upgrade.clearMaxXM);
        expect(p.d).toBeGreaterThanOrEqual(0);
        expect(p.d).toBeLessThanOrEqual(BALANCE.court.depthM);
      }
    }
    // persisted: a rejoin loads the upgraded world
    expect(storage.worlds.get("test")?.world).toEqual({
      sharedScore: 0,
      tierId: 2,
    });
    expect(storage.logs.some((e) => e.kind === "upgrade")).toBe(true);
  });

  it("rejects a press below the threshold", async () => {
    const { room } = await makeRoom(T2.threshold - 1);
    const a = new FakeWS();
    await room.join(a as unknown as WebSocket, identity("alice"));
    room.handle("alice", { t: "move-to", x: BUTTON.x, d: BUTTON.d });
    room.handle("alice", { t: "upgrade" });
    expect(a.of("upgraded")).toHaveLength(0);
  });

  it("rejects a press from a player who isn't at the button", async () => {
    const { room } = await makeRoom(T2.threshold);
    const a = new FakeWS();
    await room.join(a as unknown as WebSocket, identity("alice"));
    room.handle("alice", { t: "move-to", x: 10, d: RIM.d });
    room.handle("alice", { t: "upgrade" });
    expect(a.of("upgraded")).toHaveLength(0);
  });

  it("rejects a press past the top of the ladder", async () => {
    const top = HOOP_TIERS[HOOP_TIERS.length - 1].id;
    const { room } = await makeRoom(999999, top);
    const a = new FakeWS();
    await room.join(a as unknown as WebSocket, identity("alice"));
    room.handle("alice", { t: "move-to", x: BUTTON.x, d: BUTTON.d });
    room.handle("alice", { t: "upgrade" });
    expect(a.of("upgraded")).toHaveLength(0);
  });

  it("late joiners are welcomed straight into the upgraded world", async () => {
    const { room } = await makeRoom(T2.threshold);
    const a = new FakeWS();
    await room.join(a as unknown as WebSocket, identity("alice"));
    room.handle("alice", { t: "move-to", x: BUTTON.x, d: BUTTON.d });
    room.handle("alice", { t: "upgrade" });

    const late = new FakeWS();
    await room.join(late as unknown as WebSocket, identity("carol"));
    const [welcome] = late.of("welcome");
    if (welcome?.t !== "welcome") throw new Error("no welcome");
    expect(welcome.world).toEqual({ sharedScore: 0, tierId: 2 });
  });
});
