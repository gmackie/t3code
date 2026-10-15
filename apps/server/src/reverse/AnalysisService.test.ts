import { describe, expect, it } from "vite-plus/test";
import { ToolSlots } from "./AnalysisService.ts";

describe("analysis worker slots", () => {
  it("runs a few tools at once, queues a few more, and refuses the rest", async () => {
    const slots = new ToolSlots(2, 1);
    const releases: Array<() => void> = [];
    let started = 0;
    const job = () =>
      slots.use(
        () =>
          new Promise<number>((resolve) => {
            const order = ++started;
            releases.push(() => resolve(order));
          }),
      );
    const first = job();
    const second = job();
    const queued = job();
    await expect(job()).rejects.toMatchObject({ reason: "unavailable" });
    await Promise.resolve();
    expect(started).toBe(2);

    releases[0]!();
    expect(await first).toBe(1);
    // A job arriving as a slot frees up waits its turn instead of jumping in beside the waiter.
    const late = job();
    await Promise.resolve();
    expect(started).toBe(3);
    releases[1]!();
    releases[2]!();
    expect(await Promise.all([second, queued])).toEqual([2, 3]);
    await Promise.resolve();
    expect(started).toBe(4);
    releases[3]!();
    expect(await late).toBe(4);
  });
});
