/**
 * Which threads a client is showing: every live `subscribeThread` stream is one viewer.
 * Background work that only matters to someone looking (polling a linked pull request)
 * asks here and slows down for threads nobody is looking at.
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

/**
 * How long a thread still counts as shown after its last viewer left, so switching between
 * threads, or a reconnect, does not drop it to the slow cadence and back.
 */
const LINGER_MS = 2 * 60_000;

export class ThreadViewers extends Context.Service<
  ThreadViewers,
  {
    /** Counts the thread as shown while `stream` runs. */
    readonly track: (
      threadId: string,
    ) => <A, E, R>(stream: Stream.Stream<A, E, R>) => Stream.Stream<A, E, R>;
    /** The threads shown now, or within the last couple of minutes. */
    readonly viewed: Effect.Effect<ReadonlySet<string>>;
  }
>()("t3/orchestration-v2/ThreadViewers") {}

/** @public */
export const make = Effect.sync(() => {
  const open = new Map<string, number>();
  const leftAt = new Map<string, number>();

  const arrive = (threadId: string) =>
    Effect.sync(() => {
      open.set(threadId, (open.get(threadId) ?? 0) + 1);
      leftAt.delete(threadId);
    });
  const leave = (threadId: string) =>
    Clock.currentTimeMillis.pipe(
      Effect.map((now) => {
        const remaining = (open.get(threadId) ?? 1) - 1;
        if (remaining > 0) {
          open.set(threadId, remaining);
          return;
        }
        open.delete(threadId);
        leftAt.set(threadId, now);
      }),
    );

  const track: ThreadViewers["Service"]["track"] = (threadId) => (stream) =>
    Stream.fromEffect(arrive(threadId)).pipe(
      Stream.flatMap(() => stream),
      Stream.ensuring(leave(threadId)),
    );

  const viewed = Clock.currentTimeMillis.pipe(
    Effect.map((now) => {
      for (const [threadId, at] of leftAt) if (now - at >= LINGER_MS) leftAt.delete(threadId);
      return new Set([...open.keys(), ...leftAt.keys()]) as ReadonlySet<string>;
    }),
  );

  return ThreadViewers.of({ track, viewed });
});

export const layer = Layer.effect(ThreadViewers, make);
