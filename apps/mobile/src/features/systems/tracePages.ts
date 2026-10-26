export const TRACE_PAGE_SIZE = 100;

/** One fetched trace page, remembered by the cursor it was requested from. */
export interface TracePage<E> {
  readonly cursor: string;
  readonly events: ReadonlyArray<E>;
  readonly nextSequence: string;
  readonly hasMore: boolean;
}

/** Replaces the page fetched from the same cursor (a live refresh) or appends a new one. */
export function storeTracePage<E>(
  pages: ReadonlyArray<TracePage<E>>,
  page: TracePage<E>,
): ReadonlyArray<TracePage<E>> {
  const index = pages.findIndex((entry) => entry.cursor === page.cursor);
  if (index === -1) return [...pages, page];
  return pages.map((entry, position) => (position === index ? page : entry));
}

/** Only an unfilled last page can grow while the run is live; refetch it from its cursor. */
export function growingTraceCursor<E>(pages: ReadonlyArray<TracePage<E>>): string | null {
  const last = pages.at(-1);
  if (!last) return "0";
  return last.events.length < TRACE_PAGE_SIZE ? last.cursor : null;
}

/** The cursor of the next page to load, or null while the last page is unfilled or final. */
export function nextTraceCursor<E>(
  pages: ReadonlyArray<TracePage<E>>,
  live: boolean,
): string | null {
  const last = pages.at(-1);
  if (!last || last.events.length < TRACE_PAGE_SIZE) return null;
  return last.hasMore || live ? last.nextSequence : null;
}
