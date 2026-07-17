import { describe, expect, it, vi } from "vitest";
import { Analytics, initAnalytics, track } from "./analytics";

// The queue-and-batch behaviour is what keeps analytics harmless:
// rows lead with [ts, lobby, pid], batches carry the secret, a failed
// POST drops (never retries into gameplay), and the uninitialized
// module no-ops.

const fixedNow = () => new Date("2026-07-17T12:00:00.000Z");

function make(overrides: Partial<ConstructorParameters<typeof Analytics>[0]> = {}) {
  const calls: { url: string; body: unknown }[] = [];
  const fetchFn = vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response("ok");
  }) as unknown as typeof fetch;
  const a = new Analytics({
    url: "https://script.example/exec",
    secret: "s3cret",
    fetchFn,
    now: fixedNow,
    ...overrides,
  });
  return { a, calls, fetchFn };
}

describe("Analytics", () => {
  it("prefixes every row with ts, lobby, pid and batches with the secret", async () => {
    const { a, calls } = make();
    a.track("throws", "mossy-fox-3f2a", "p-1", 7.5, "swish", 300);
    a.track("features", "mossy-fox-3f2a", "p-2", "catch", "done", "");
    await a.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({
      secret: "s3cret",
      events: [
        {
          sheet: "throws",
          row: ["2026-07-17T12:00:00.000Z", "mossy-fox-3f2a", "p-1", 7.5, "swish", 300],
        },
        {
          sheet: "features",
          row: ["2026-07-17T12:00:00.000Z", "mossy-fox-3f2a", "p-2", "catch", "done", ""],
        },
      ],
    });
  });

  it("flushes immediately when the queue reaches maxBatch", () => {
    const { a, fetchFn } = make({ maxBatch: 3 });
    a.track("ops", "", "", "server_boot", "");
    a.track("ops", "", "", "server_boot", "");
    expect(fetchFn).not.toHaveBeenCalled();
    a.track("ops", "", "", "server_boot", "");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("flushes on the timer without a full batch", async () => {
    vi.useFakeTimers();
    try {
      const { a, fetchFn } = make({ flushMs: 1000 });
      a.track("growth", "l", "p", "first_throw");
      expect(fetchFn).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1001);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops the batch on a failed POST and keeps accepting rows", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const a = new Analytics({
      url: "https://script.example/exec",
      secret: "s",
      fetchFn,
      now: fixedNow,
    });
    a.track("ops", "", "", "server_boot", "");
    await expect(a.flush()).resolves.toBeUndefined(); // never throws
    a.track("ops", "", "", "server_boot", "again");
    await a.flush();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("an empty queue flushes to nothing", async () => {
    const { a, fetchFn } = make();
    await a.flush();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("module singleton", () => {
  it("no-ops without ANALYTICS_URL, tracks with it", () => {
    expect(initAnalytics({})).toBeNull();
    track("ops", "", "", "server_boot", ""); // must not throw while off
    const a = initAnalytics({
      ANALYTICS_URL: "https://script.example/exec",
      ANALYTICS_SECRET: "s",
    });
    expect(a).toBeInstanceOf(Analytics);
    a?.stop();
    initAnalytics({}); // leave the module off for other test files
  });
});
