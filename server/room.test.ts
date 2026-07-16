import { afterEach, describe, expect, it, vi } from "vitest";
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
// press, but the server owns the rules - threshold met, presser at the
// button - and the reset + teleport-clear + broadcast that follow.

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

const T2 = HOOP_TIERS[1];

/** Walk the player to the hoop's base via pose telemetry - the Upgrade
 *  errand goes THROUGH the keep-out zone, which move-to never allows;
 *  the pose clamp opens the zone while an upgrade is available. */
function standAtHoop(room: Room, id: string) {
  room.handle(id, {
    t: "pose",
    s: {
      x: RIM.x - 0.6,
      d: RIM.d,
      airH: 0,
      facing: 1,
      angle: 0,
      pose: { kind: "walk", t: 0 },
    },
  });
}

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

describe("offline characters wait around", () => {
  const ws = (f: FakeWS) => f as unknown as WebSocket;

  it("leave marks the character offline instead of removing it", async () => {
    const { room } = await makeRoom(0);
    const a = new FakeWS();
    const b = new FakeWS();
    await room.join(ws(a), identity("alice"));
    await room.join(ws(b), identity("bob"));
    room.leave("bob", ws(b));

    // alice hears player-offline, NOT player-left; bob's character stays
    expect(a.of("player-offline")).toHaveLength(1);
    expect(a.of("player-left")).toHaveLength(0);
    expect(room.size).toBe(1); // size counts CONNECTED players only

    // a late joiner still receives bob, flagged offline
    const c = new FakeWS();
    await room.join(ws(c), identity("cara"));
    const [w] = c.of("welcome");
    if (w?.t !== "welcome") throw new Error("unreachable");
    const bob = w.players.find((p) => p.id === "bob");
    expect(bob?.offline).toBe(true);
  });

  it("rejoining reclaims the waiting character in place, un-grayed", async () => {
    const { room } = await makeRoom(0);
    const a = new FakeWS();
    const b = new FakeWS();
    await room.join(ws(a), identity("alice"));
    await room.join(ws(b), identity("bob"));
    room.handle("bob", { t: "move-to", x: 10, d: 2 });
    room.leave("bob", ws(b));

    const b2 = new FakeWS();
    await room.join(ws(b2), identity("bob"));
    const joins = a.of("player-joined");
    const last = joins[joins.length - 1];
    if (last?.t !== "player-joined") throw new Error("unreachable");
    expect(last.player.id).toBe("bob");
    expect(last.player.offline).toBeUndefined(); // back online
    expect(last.player.x).toBeCloseTo(10, 5); //   exactly where it stood
  });

  it("after the delay the character walks to its waiting spot", async () => {
    vi.useFakeTimers();
    try {
      const { room } = await makeRoom(0); // tier 1 → the far-sideline spot
      const a = new FakeWS();
      const b = new FakeWS();
      await room.join(ws(a), identity("alice"));
      await room.join(ws(b), identity("bob"));
      room.leave("bob", ws(b));
      expect(a.of("move-to")).toHaveLength(0); // not yet - it waits first

      vi.advanceTimersByTime(BALANCE.presence.offlineWalkDelayS * 1000 + 50);
      const mv = a.of("move-to").find((m) => m.t === "move-to" && m.id === "bob");
      if (mv?.t !== "move-to") throw new Error("no waiting walk broadcast");
      expect(mv.d).toBeLessThan(1); // the upper side of the field
      expect(mv.x).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a reclaim before the delay cancels the waiting walk", async () => {
    vi.useFakeTimers();
    try {
      const { room } = await makeRoom(0);
      const a = new FakeWS();
      const b = new FakeWS();
      await room.join(ws(a), identity("alice"));
      await room.join(ws(b), identity("bob"));
      room.leave("bob", ws(b));
      const b2 = new FakeWS();
      await room.join(ws(b2), identity("bob"));
      vi.advanceTimersByTime(BALANCE.presence.offlineWalkDelayS * 1000 + 50);
      expect(a.of("move-to")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the last CONNECTED player leaving tears the room down anyway", async () => {
    const storage = new MemStorage();
    storage.worlds.set("test", {
      lobby: "test",
      world: { sharedScore: 0, tierId: 1 },
      history: [],
    });
    let empty = false;
    room = new Room("test", storage, () => {
      empty = true;
    });
    const a = new FakeWS();
    const b = new FakeWS();
    await room.join(ws(a), identity("alice"));
    await room.join(ws(b), identity("bob"));
    room.leave("bob", ws(b));
    expect(empty).toBe(false); // alice is still connected
    room.leave("alice", ws(a));
    expect(empty).toBe(true); // offline characters don't keep it alive
  });

  it("an offline character does not count against maxPlayers", async () => {
    const { room } = await makeRoom(0);
    const sockets: FakeWS[] = [];
    for (let i = 0; i < BALANCE.lobby.maxPlayers; i++) {
      const f = new FakeWS();
      sockets.push(f);
      expect(await room.join(ws(f), identity(`p${i}`))).toBe(true);
    }
    // full for a newcomer…
    const extra = new FakeWS();
    expect(await room.join(ws(extra), identity("late"))).toBe(false);
    // …but one player going offline frees a connected slot
    room.leave("p0", ws(sockets[0]));
    const extra2 = new FakeWS();
    expect(await room.join(ws(extra2), identity("late2"))).toBe(true);
  });
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

describe("catch the ball", () => {
  const ws = (f: FakeWS) => f as unknown as WebSocket;
  // a weak lob from mid-court: never reaches the rim - always a miss
  const missLaunch = {
    shotX: 20,
    shotD: 3,
    x: 20.5,
    d: 3,
    h: 2.2,
    vx: 5,
    vh: 5,
    slam: false,
  };

  /** Throw and let the scheduled outcome fire (well past resolvedAtS,
   *  well inside catchBall.windowS). */
  function missOne(r: Room, throwId: string) {
    r.handle("bob", { t: "throw", throwId, launch: missLaunch });
    vi.advanceTimersByTime(10_000);
  }

  it("refunds the throw, retro-marks the wall line, tells everyone", async () => {
    vi.useFakeTimers();
    try {
      const { room, storage } = await makeRoom(0);
      const a = new FakeWS();
      const b = new FakeWS();
      await room.join(ws(a), identity("alice"));
      await room.join(ws(b), identity("bob"));
      missOne(room, "t1");
      expect(b.of("outcome")).toHaveLength(1);

      room.handle("bob", { t: "catch", throwId: "t1" });

      // both hear it; the catcher's budget is whole again
      expect(a.of("caught")).toHaveLength(1);
      expect(b.of("caught")).toHaveLength(1);
      const budgets = b.of("budget");
      const last = budgets[budgets.length - 1];
      if (last?.t !== "budget") throw new Error("no budget update");
      expect(last.throwsRemaining).toBe(BALANCE.budget.throwsPerDay);
      // the wall: the miss is retro-marked caught, a catch entry follows
      expect(storage.logs.some((e) => e.kind === "catch")).toBe(true);
      const late = new FakeWS();
      await room.join(ws(late), identity("carol"));
      const [w] = late.of("welcome");
      if (w?.t !== "welcome") throw new Error("no welcome");
      const outcome = w.history.find((h) => h.kind === "outcome");
      if (outcome?.kind !== "outcome") throw new Error("no outcome entry");
      expect(outcome.caught).toBe(true);
      expect(w.history.some((h) => h.kind === "catch")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("only the thrower may catch, and only a resolved miss", async () => {
    vi.useFakeTimers();
    try {
      const { room } = await makeRoom(0);
      const a = new FakeWS();
      const b = new FakeWS();
      await room.join(ws(a), identity("alice"));
      await room.join(ws(b), identity("bob"));
      // unknown throw: nothing happens
      room.handle("bob", { t: "catch", throwId: "nope" });
      expect(b.of("caught")).toHaveLength(0);
      // someone else's miss: nothing happens
      missOne(room, "t1");
      room.handle("alice", { t: "catch", throwId: "t1" });
      expect(a.of("caught")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("once per ball: the throw made with a caught ball is not catchable", async () => {
    vi.useFakeTimers();
    try {
      const { room } = await makeRoom(0);
      const b = new FakeWS();
      await room.join(ws(b), identity("bob"));
      missOne(room, "t1");
      room.handle("bob", { t: "catch", throwId: "t1" });
      expect(b.of("caught")).toHaveLength(1);
      // the refunded ball flies again and misses again…
      missOne(room, "t2");
      room.handle("bob", { t: "catch", throwId: "t2" });
      // …but this ball was already caught once - no second refund
      expect(b.of("caught")).toHaveLength(1);
      // and a repeat catch of the first throw is spent too
      room.handle("bob", { t: "catch", throwId: "t1" });
      expect(b.of("caught")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
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

    // alice walks up to the hoop (through the open zone) and presses
    standAtHoop(room, "alice");
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
    standAtHoop(room, "alice");
    room.handle("alice", { t: "upgrade" });
    expect(a.of("upgraded")).toHaveLength(0);
  });

  it("rejects a press from a player who isn't at the hoop", async () => {
    const { room } = await makeRoom(T2.threshold);
    const a = new FakeWS();
    await room.join(a as unknown as WebSocket, identity("alice"));
    room.handle("alice", { t: "move-to", x: 10, d: RIM.d });
    room.handle("alice", { t: "upgrade" });
    expect(a.of("upgraded")).toHaveLength(0);
  });

  it("the keep-out zone only opens for poses while an upgrade is available", async () => {
    const { room } = await makeRoom(T2.threshold - 1); // NOT ready
    const a = new FakeWS();
    const b = new FakeWS();
    await room.join(a as unknown as WebSocket, identity("alice"));
    await room.join(b as unknown as WebSocket, identity("bob"));
    standAtHoop(room, "alice"); // zone closed → clamped back out
    const [pose] = b.of("pose");
    if (pose?.t !== "pose") throw new Error("no pose relayed");
    expect(pose.s.x).toBeLessThanOrEqual(RIM.x - BALANCE.move.hoopStandoffM);
  });

  it("rejects a press past the top of the ladder", async () => {
    const top = HOOP_TIERS[HOOP_TIERS.length - 1].id;
    const { room } = await makeRoom(999999, top);
    const a = new FakeWS();
    await room.join(a as unknown as WebSocket, identity("alice"));
    standAtHoop(room, "alice");
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
      expect(jb.state).not.toBeNull();
      expect(jb.state!.song).toBeGreaterThanOrEqual(0);
      expect(jb.state!.song).toBeLessThan(BALANCE.jukebox.songs);
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

  it("jukebox-off: clears the song for everyone, only while playing", async () => {
    const { room, storage } = await makeRoom(0, 3);
    const a = new FakeWS();
    const b = new FakeWS();
    await room.join(a as unknown as WebSocket, identity("alice"));
    await room.join(b as unknown as WebSocket, identity("bob"));
    room.handle("alice", { t: "move-to", x: 16.8, d: 0 });

    // nothing playing yet - the off press is ignored
    room.handle("alice", { t: "jukebox-off" });
    expect(a.of("jukebox")).toHaveLength(0);

    room.handle("alice", { t: "jukebox" });
    room.handle("alice", { t: "jukebox-off" });
    for (const ws of [a, b]) {
      const evs = ws.of("jukebox");
      const last = evs[evs.length - 1];
      if (last?.t !== "jukebox") throw new Error("unreachable");
      expect(last.state).toBeNull(); // OFF, synced to everyone
      expect(last.byName).toBe("alice");
    }
    // persisted: late joiners get silence
    expect(storage.worlds.get("test")?.world.jukebox).toBeNull();
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
    standAtHoop(room, "alice");
    room.handle("alice", { t: "upgrade" });

    const late = new FakeWS();
    await room.join(late as unknown as WebSocket, identity("carol"));
    const [welcome] = late.of("welcome");
    if (welcome?.t !== "welcome") throw new Error("no welcome");
    expect(welcome.world).toEqual({ sharedScore: 0, tierId: 2 });
  });
});
