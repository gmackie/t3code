import { describe, expect, it, vi } from "vite-plus/test";
import { Atom } from "effect/reactivity";
import { MessageId, RunId } from "@t3tools/contracts";

import { beginQueuedRunEdit, endQueuedRunEdit, getQueuedRunEdit } from "./queued-run-edit";
import { appAtomRegistry } from "./atom-registry";
import { submitComposer } from "./submit-composer";

const threadKey = "environment:thread";
const edit = () => ({
  runId: RunId.make("run"),
  messageId: MessageId.make("message"),
  originalText: "Teh",
  existingAttachments: [],
});

function beginEdit() {
  const queued = edit();
  const runs = Atom.make<ReadonlyArray<{ readonly id: RunId; readonly status: string }> | null>([
    { id: queued.runId, status: "queued" },
  ]);
  beginQueuedRunEdit(threadKey, queued, runs);
  return { queued, runs };
}

function pendingSubmission() {
  const correction = Promise.withResolvers<string>();
  let draft = "original draft";
  let active = true;
  const send = vi.fn(async () => {
    return getQueuedRunEdit(threadKey) === null ? MessageId.make("new-message") : null;
  });
  const result = submitComposer(
    threadKey,
    {
      focus() {},
      blur() {},
      setSelection() {},
      async prepareForSubmit(isCurrent) {
        const text = await correction.promise;
        if (!isCurrent()) return false;
        draft = text;
        return true;
      },
    },
    send,
    () => active,
  );
  return {
    correction,
    result,
    send,
    draft: () => draft,
    leave: () => {
      active = false;
    },
  };
}

describe("submitComposer", () => {
  it.each(["cancellation", "run-status recovery", "replacement edit"])(
    "does not overwrite the regular draft or submit after %s during preparation",
    async (change) => {
      const { queued, runs } = beginEdit();
      const pending = pendingSubmission();
      if (change === "run-status recovery") {
        appAtomRegistry.set(runs, [{ id: queued.runId, status: "running" }]);
      } else {
        endQueuedRunEdit(threadKey);
      }
      if (change === "replacement edit") beginEdit();
      pending.correction.resolve("The");
      expect(await pending.result).toBeNull();
      expect(pending.draft()).toBe("original draft");
      expect(pending.send).not.toHaveBeenCalled();
    },
  );

  it("discards preparation after leaving the initiating draft", async () => {
    endQueuedRunEdit(threadKey);
    const pending = pendingSubmission();
    pending.leave();
    pending.correction.resolve("The");
    expect(await pending.result).toBeNull();
    expect(pending.draft()).toBe("original draft");
    expect(pending.send).not.toHaveBeenCalled();
  });

  it("rechecks edit identity before dispatch even after preparation succeeds", async () => {
    beginEdit();
    const send = vi.fn(async () => MessageId.make("new-message"));
    const result = submitComposer(
      threadKey,
      {
        focus() {},
        blur() {},
        setSelection() {},
        async prepareForSubmit() {
          queueMicrotask(() => endQueuedRunEdit(threadKey));
          return true;
        },
      },
      send,
      () => true,
    );
    expect(await result).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it.each([false, undefined])("handles preparation result %s", async (prepared) => {
    endQueuedRunEdit(threadKey);
    const send = vi.fn(async () => MessageId.make("new-message"));
    const result = await submitComposer(
      threadKey,
      {
        focus() {},
        blur() {},
        setSelection() {},
        ...(prepared === false ? { prepareForSubmit: async () => false } : {}),
      },
      send,
      () => true,
    );
    expect(result).toBe(prepared === false ? null : "new-message");
    expect(send).toHaveBeenCalledTimes(prepared === false ? 0 : 1);
  });

  it("saves the corrected text when the edit is still current", async () => {
    beginEdit();
    const pending = pendingSubmission();
    pending.correction.resolve("The");
    expect(await pending.result).toBeNull();
    expect(pending.draft()).toBe("The");
    expect(pending.send).toHaveBeenCalledOnce();
  });

  it("submits a regular draft after accepting its correction", async () => {
    endQueuedRunEdit(threadKey);
    const pending = pendingSubmission();
    pending.correction.resolve("The");
    expect(await pending.result).toBe("new-message");
    expect(pending.draft()).toBe("The");
  });
});
