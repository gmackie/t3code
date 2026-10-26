import { describe, expect, it } from "vite-plus/test";

import {
  growingTraceCursor,
  nextTraceCursor,
  storeTracePage,
  TRACE_PAGE_SIZE,
  type TracePage,
} from "./tracePages";

const events = (from: number, count: number) =>
  Array.from({ length: count }, (_, index) => ({ sequence: String(from + index) }));

const page = (
  cursor: number,
  count: number,
  hasMore: boolean,
): TracePage<{ sequence: string }> => ({
  cursor: String(cursor),
  events: events(cursor, count),
  nextSequence: String(cursor + count),
  hasMore,
});

describe("trace pages", () => {
  it("starts from the first sequence and refreshes only an unfilled last page", () => {
    expect(growingTraceCursor([])).toBe("0");
    const partial = [page(0, 40, false)];
    expect(growingTraceCursor(partial)).toBe("0");
    expect(growingTraceCursor([page(0, TRACE_PAGE_SIZE, true)])).toBeNull();
  });

  it("replaces a refreshed page in place and appends new ones", () => {
    const refreshed = storeTracePage([page(0, 40, false)], page(0, TRACE_PAGE_SIZE, true));
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]?.events).toHaveLength(TRACE_PAGE_SIZE);
    const appended = storeTracePage(refreshed, page(TRACE_PAGE_SIZE, 10, false));
    expect(appended.map((entry) => entry.cursor)).toEqual(["0", String(TRACE_PAGE_SIZE)]);
  });

  it("offers more after a full page while more exist or the run can still add them", () => {
    const full = [page(0, TRACE_PAGE_SIZE, false)];
    expect(nextTraceCursor(full, false)).toBeNull();
    expect(nextTraceCursor(full, true)).toBe(String(TRACE_PAGE_SIZE));
    expect(nextTraceCursor([page(0, TRACE_PAGE_SIZE, true)], false)).toBe(String(TRACE_PAGE_SIZE));
    expect(nextTraceCursor([page(0, 40, true)], true)).toBeNull();
    expect(nextTraceCursor([], true)).toBeNull();
  });
});
