import { afterAll, describe, expect, it } from "vitest";
import { PgStorage } from "./pgStorage";

// The Postgres contract, run against a REAL database - set
// TEST_DATABASE_URL to enable (CI and plain `npm test` skip it):
//   $env:TEST_DATABASE_URL = "postgresql://..."; npm test
// Uses throwaway keys so a live/shared database stays clean-ish.

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("PgStorage (live database)", () => {
  const store = url ? new PgStorage(url) : null!;
  const stamp = `t${Date.now().toString(36)}`;
  const lobby = `vitest-${stamp}`;

  afterAll(async () => {
    await store?.close();
  });

  it("world bundles round-trip and upsert", async () => {
    expect(await store.loadWorld(lobby)).toBeNull();
    const bundle = {
      lobby,
      world: { sharedScore: 321, tierId: 2 },
      history: [{ kind: "reset" as const, name: "vitest" }],
    };
    await store.saveWorld(bundle);
    expect(await store.loadWorld(lobby)).toEqual(bundle);
    bundle.world.sharedScore = 999;
    await store.saveWorld(bundle);
    expect((await store.loadWorld(lobby))?.world.sharedScore).toBe(999);
  });

  it("profiles round-trip with nested budgets", async () => {
    const profile = {
      id: `vitest-p-${stamp}`,
      name: "Vitest",
      shirtColor: 0x123456,
      budgets: { [lobby]: { throwsUsedToday: 3, lastThrowDayUTC: "2026-07-17" } },
    };
    await store.saveProfile(profile);
    expect(await store.loadProfile(profile.id)).toEqual(profile);
  });

  it("log entries append", async () => {
    await store.appendLog(lobby, {
      at: Date.now(),
      kind: "chat",
      name: "Vitest",
      text: "hello wall",
    });
    // append-only - nothing reads it back at runtime; reaching here
    // without a throw is the contract
  });

  it("recordings round-trip per lobby + throwId", async () => {
    const rec = { name: "Vitest", playerSamples: [{ t: 0 }], done: true };
    expect(await store.loadRecording(lobby, "t1-abc")).toBeNull();
    await store.saveRecording(lobby, "t1-abc", rec);
    expect(await store.loadRecording(lobby, "t1-abc")).toEqual(rec);
  });
});
