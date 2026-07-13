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

describe("throw budgets are PER LOBBY", () => {
  it("balls spent in one lobby don't follow the player to a fresh one", async () => {
    const storage = new MemStorage();
    const onEmpty = () => {};
    const roomA = new Room("court-a", storage, onEmpty);
    const roomB = new Room("court-b", storage, onEmpty);
    try {
      const wsA = new FakeWS();
      await roomA.join(wsA as unknown as WebSocket, identity("bob"));

      // bob spends two balls in court A
      const launch = {
        shotX: 20,
        shotD: 3,
        x: 20.5,
        d: 3,
        h: 2.2,
        vx: 5,
        vh: 5,
        slam: false,
      };
      roomA.handle("bob", { t: "throw", throwId: "t1", launch });
      roomA.handle("bob", { t: "throw", throwId: "t2", launch });
      const budgets = wsA.of("budget");
      if (budgets[1]?.t !== "budget") throw new Error("no budget updates");
      expect(budgets[1].throwsRemaining).toBe(BALANCE.budget.throwsPerDay - 2);

      // …then walks into court B: a fresh set of balls
      const wsB = new FakeWS();
      await roomB.join(wsB as unknown as WebSocket, identity("bob"));
      const [welcome] = wsB.of("welcome");
      if (welcome?.t !== "welcome") throw new Error("no welcome");
      expect(welcome.throwsRemaining).toBe(BALANCE.budget.throwsPerDay);

      // …and court A still remembers what he spent there
      const wsA2 = new FakeWS();
      await roomA.join(wsA2 as unknown as WebSocket, identity("bob"));
      const [welcomeA] = wsA2.of("welcome");
      if (welcomeA?.t !== "welcome") throw new Error("no welcome A");
      expect(welcomeA.throwsRemaining).toBe(BALANCE.budget.throwsPerDay - 2);
    } finally {
      roomA.destroy();
      roomB.destroy();
    }
  });
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

  it("jukebox: a press at the box re-rolls the synced song for everyone", async () => {
    const { room, storage } = await makeRoom(0, 3); // tier 3: the box exists
    const a = new FakeWS();
    const b = new FakeWS();
    await room.join(a as unknown as WebSocket, identity("alice"));
    await room.join(b as unknown as WebSocket, identity("bob"));

    // alice stands by the box (its d is off-court; nearest court spot works)
    room.handle("alice", { t: "move-to", x: 16.8, d: 0 });
    room.handle("alice", { t: "jukebox" });

    for (const ws of [a, b]) {
      const [jb] = ws.of("jukebox");
      expect(jb).toBeDefined();
      if (jb?.t !== "jukebox") throw new Error("unreachable");
      expect(jb.byName).toBe("alice");
      expect(jb.state.song).toBeGreaterThanOrEqual(0);
      expect(jb.state.song).toBeLessThan(BALANCE.jukebox.songs);
    }
    // persisted + carried by welcome, so late joiners hear it too
    const world = storage.worlds.get("test")?.world;
    expect(world?.jukebox?.song).toBeDefined();

    // pressing again always lands on a DIFFERENT song
    const first = world!.jukebox!.song;
    room.handle("alice", { t: "jukebox" });
    const second = storage.worlds.get("test")?.world.jukebox?.song;
    expect(second).not.toBe(first);
  });

  it("jukebox: no box below tier 3, no press from across the court", async () => {
    const t2 = await makeRoom(0, 2);
    const a = new FakeWS();
    await t2.room.join(a as unknown as WebSocket, identity("alice"));
    t2.room.handle("alice", { t: "move-to", x: 16.8, d: 0 });
    t2.room.handle("alice", { t: "jukebox" });
    expect(a.of("jukebox")).toHaveLength(0);
    t2.room.destroy();

    const t3 = await makeRoom(0, 3);
    room = t3.room; // afterEach cleans this one
    const c = new FakeWS();
    await t3.room.join(c as unknown as WebSocket, identity("carol"));
    t3.room.handle("carol", { t: "move-to", x: 5, d: 3 }); // far away
    t3.room.handle("carol", { t: "jukebox" });
    expect(c.of("jukebox")).toHaveLength(0);
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
