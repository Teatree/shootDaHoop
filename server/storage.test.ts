import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonFileStorage, type ArchivedEntry } from "./storage";

// The permanent log archive: every wall entry, forever, per lobby.
// Append-only JSONL - these tests pin the "nothing is ever dropped or
// rewritten" contract that room.record() relies on.

describe("JsonFileStorage.appendLog", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sdh-storage-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const readLines = async (lobby: string): Promise<ArchivedEntry[]> => {
    const raw = await readFile(join(dir, "logs", `${lobby}.jsonl`), "utf8");
    return raw
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as ArchivedEntry);
  };

  it("appends entries in order without dropping earlier ones", async () => {
    const s = new JsonFileStorage(dir);
    await s.appendLog("court-a", { at: 1, kind: "presence", name: "Ann", joined: true });
    await s.appendLog("court-a", { at: 2, kind: "chat", name: "Ann", text: "hi" });
    await s.appendLog("court-a", {
      at: 3,
      kind: "outcome",
      name: "Ann",
      made: false,
      swish: false,
      slam: false,
      distM: 6.2,
      points: 0,
    });

    expect(await readLines("court-a")).toEqual([
      { at: 1, kind: "presence", name: "Ann", joined: true },
      { at: 2, kind: "chat", name: "Ann", text: "hi" },
      { at: 3, kind: "outcome", name: "Ann", made: false, swish: false, slam: false, distM: 6.2, points: 0 },
    ]);
  });

  it("keeps each lobby's archive in its own file", async () => {
    const s = new JsonFileStorage(dir);
    await s.appendLog("court-a", { at: 1, kind: "reset", name: "Ann" });
    await s.appendLog("court-b", { at: 2, kind: "reset", name: "Bob" });

    expect(await readLines("court-a")).toEqual([{ at: 1, kind: "reset", name: "Ann" }]);
    expect(await readLines("court-b")).toEqual([{ at: 2, kind: "reset", name: "Bob" }]);
  });

  it("survives a fresh Storage instance (append, not overwrite)", async () => {
    await new JsonFileStorage(dir).appendLog("court-a", { at: 1, kind: "reset", name: "Ann" });
    await new JsonFileStorage(dir).appendLog("court-a", { at: 2, kind: "reset", name: "Bob" });

    expect(await readLines("court-a")).toEqual([
      { at: 1, kind: "reset", name: "Ann" },
      { at: 2, kind: "reset", name: "Bob" },
    ]);
  });
});
