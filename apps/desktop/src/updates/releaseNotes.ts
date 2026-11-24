import type { DesktopUpdateChannel, DesktopUpdateReleaseNote } from "@t3tools/contracts";

import { desktopUpdateChannelOf } from "@t3tools/shared/cliRelease";
import {
  parseGmackoChangelogManifest,
  type GmackoChangelogManifest,
} from "@t3tools/shared/gmackoChangelog";

interface ElectronReleaseNoteInfo {
  readonly version: string;
  readonly note: string | null | undefined;
}

function isElectronReleaseNoteInfo(value: unknown): value is ElectronReleaseNoteInfo {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { readonly version?: unknown; readonly note?: unknown };
  return (
    typeof candidate.version === "string" &&
    (typeof candidate.note === "string" || candidate.note === null || candidate.note === undefined)
  );
}

const MAX_RELEASE_NOTE_GROUPS = 6;
const MAX_RELEASE_NOTE_ITEMS_PER_GROUP = 8;
const MAX_RELEASE_NOTE_ITEM_LENGTH = 220;

const HTML_ENTITY_REPLACEMENTS: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["lt", "<"],
  ["nbsp", " "],
  ["quot", '"'],
]);

function decodeCodePoint(codePoint: number, entity: string): string {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return `&${entity};`;
  }
  return String.fromCodePoint(codePoint);
}

function decodeHtmlEntity(entity: string): string {
  const named = HTML_ENTITY_REPLACEMENTS.get(entity);
  if (named) return named;
  if (entity.startsWith("#x")) {
    return decodeCodePoint(Number.parseInt(entity.slice(2), 16), entity);
  }
  if (entity.startsWith("#")) {
    return decodeCodePoint(Number.parseInt(entity.slice(1), 10), entity);
  }
  return `&${entity};`;
}

function decodeHtmlEntities(input: string): string {
  return input.replace(/&([a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/g, (_, entity: string) =>
    decodeHtmlEntity(entity),
  );
}

function stripMarkup(input: string, keepBold = false): string {
  const markdown = decodeHtmlEntities(
    input
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<h([1-6])\b[^>]*>/gi, (_, level: string) => `\n${"#".repeat(Number(level))} `)
      .replace(/<\/(?:p|div|li|h[1-6]|ul|ol|blockquote)>/gi, "\n")
      .replace(/<\/?(?:strong|b)\b[^>]*>/gi, "**")
      .replace(/<[^>]*>/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"),
  );
  return keepBold ? markdown : markdown.replace(/\*\*([^*]+)\*\*/g, "$1");
}

function truncateReleaseNoteItem(item: string): string {
  if (item.length <= MAX_RELEASE_NOTE_ITEM_LENGTH) return item;
  return `${item.slice(0, MAX_RELEASE_NOTE_ITEM_LENGTH - 3).trimEnd()}...`;
}

function normalizeReleaseNoteLine(line: string): string {
  return line
    .toLowerCase()
    .replace(/[*_`#]/g, "")
    .trim();
}

function isIgnoredReleaseNoteLine(line: string): boolean {
  const normalized = normalizeReleaseNoteLine(line);
  return (
    normalized === "" ||
    normalized === "what's changed" ||
    normalized === "whats changed" ||
    normalized.startsWith("compare: ") ||
    normalized.includes("/compare/") ||
    // The feed's HTML footer loses its compare URL to stripMarkup, leaving only the range.
    /^full changelog: \S+\.\.\.\S+$/.test(normalized)
  );
}

type ExtractedReleaseNoteItems = Omit<DesktopUpdateReleaseNote, "version" | "releasedAt">;

/** Older generated notes have a highlights paragraph followed by a separate list of fixes. */
function extractReleaseNoteSummary(summary: string): ExtractedReleaseNoteItems {
  let stats: string | undefined;
  let footer: string | undefined;
  const intro: string[] = [];
  const items: string[] = [];
  for (const rawLine of stripMarkup(summary, true).split("\n")) {
    const line = rawLine
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\s*\((?:#\d+(?:,\s*)?)+\)\.?$/, "")
      .trim();
    const plain = line.replace(/\*\*([^*]+)\*\*/g, "$1");
    if (/^### Plus \d+ more /.test(plain)) {
      footer = plain.slice(4);
      continue;
    }
    if (plain === "" || /^#{1,6}\s+/.test(plain)) continue;
    if (stats === undefined && /^v\S+ · /.test(plain)) {
      stats = plain.slice(plain.indexOf(" · ") + 3);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      items.push(line.replace(/^[-*]\s+/, ""));
    } else {
      intro.push(plain);
    }
  }
  return {
    items,
    totalItems: items.length + intro.length,
    ...(intro.length > 0 ? { intro: intro.join(" ") } : {}),
    ...(stats ? { stats } : {}),
    ...(footer ? { footer } : {}),
  };
}

function labelGmackoChange(text: string): string {
  const pullRequest = /^PR (\d+):\s+(.+)$/.exec(text);
  if (!pullRequest?.[1] || !pullRequest[2]) return text;
  return `**PR ${pullRequest[1]}** ${pullRequest[2]}`;
}

function plainReleaseText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function gmackoChangesSection(note: string): string {
  const heading =
    /<h[1-6][^>]*>\s*GMACKO changes\s*<\/h[1-6]>|^#{1,6}[ \t]+GMACKO changes[ \t]*$/im.exec(note);
  const start = heading ? heading.index + heading[0].length : 0;
  const rest = note.slice(start);
  const fullChangelog = /\bfull changelog\b/i.exec(rest);
  return fullChangelog ? rest.slice(0, fullChangelog.index) : rest;
}

/** Nightly stamps contain dots (`v0.1.12-nightly.…`), so the sentence ends at the period after them. */
function includesUpstreamLine(section: string): string | undefined {
  const match = /Includes upstream (?:[^.]+|\.(?=\d))+\./.exec(plainReleaseText(section));
  return match?.[0].replace(/\s+/g, " ").trim();
}

/** The outer list only. Nested commit lists belong on the release page, not in the popover. */
function topLevelHtmlItems(section: string): string[] {
  const open = /<ul\b[^>]*>/i.exec(section);
  if (!open) return [];
  const items: string[] = [];
  let index = open.index + open[0].length;
  let depth = 1;
  while (index < section.length && depth > 0) {
    const tag = /<\/?ul\b[^>]*>|<li\b[^>]*>|<\/li\s*>/gi.exec(section.slice(index));
    if (!tag) break;
    const at = index + tag.index;
    const token = tag[0].toLowerCase();
    if (token.startsWith("<ul")) {
      depth += 1;
      index = at + tag[0].length;
      continue;
    }
    if (token.startsWith("</ul")) {
      depth -= 1;
      index = at + tag[0].length;
      continue;
    }
    if (token.startsWith("<li") && depth === 1) {
      const bodyStart = at + tag[0].length;
      const closed = closeHtmlListItem(section, bodyStart);
      const summary = plainReleaseText(closed.html.split(/<ul\b/i)[0] ?? "");
      if (summary) items.push(summary);
      index = closed.end;
      continue;
    }
    index = at + tag[0].length;
  }
  return items;
}

function closeHtmlListItem(html: string, from: number): { readonly html: string; readonly end: number } {
  let depth = 0;
  let index = from;
  while (index < html.length) {
    const tag = /<\/?ul\b[^>]*>|<\/li\s*>/gi.exec(html.slice(index));
    if (!tag) break;
    const at = index + tag.index;
    const token = tag[0].toLowerCase();
    if (token.startsWith("<ul")) depth += 1;
    else if (token.startsWith("</ul")) depth = Math.max(0, depth - 1);
    else if (depth === 0) return { html: html.slice(from, at), end: at + tag[0].length };
    index = at + tag[0].length;
  }
  return { html: html.slice(from), end: html.length };
}

function topLevelMarkdownItems(section: string): string[] {
  const items: string[] = [];
  for (const rawLine of section.split("\n")) {
    if (/^\s+[-*]\s+/.test(rawLine)) continue;
    const line = rawLine.trim();
    if (!/^[-*]\s+/.test(line)) continue;
    const text = plainReleaseText(line.replace(/^[-*]\s+/, ""));
    if (text) items.push(text);
  }
  return items;
}

function notesFromGmackoManifest(manifest: GmackoChangelogManifest): ExtractedReleaseNoteItems {
  const labels = manifest.changes.map((change) =>
    change.kind === "pr" ? `**PR ${change.number}** ${change.title}` : change.subject,
  );
  const footer = manifest.upstreamNightlyTag
    ? `Includes upstream nightly ${manifest.upstreamNightlyTag}.`
    : manifest.upstreamBaseSha
      ? `Includes upstream main up to ${manifest.upstreamBaseSha.slice(0, 7)}.`
      : undefined;
  return finishGmackoNotes(labels, footer, manifest.changes.length === 0);
}

function notesFromRenderedGmackoChanges(note: string): ExtractedReleaseNoteItems {
  const section = gmackoChangesSection(note);
  const labels = (section.includes("<li") ? topLevelHtmlItems(section) : topLevelMarkdownItems(section)).map(
    labelGmackoChange,
  );
  return finishGmackoNotes(
    labels,
    includesUpstreamLine(section),
    /No fork changes since the previous build/i.test(plainReleaseText(section)),
  );
}

function finishGmackoNotes(
  labels: ReadonlyArray<string>,
  footer: string | undefined,
  noForkChanges: boolean,
): ExtractedReleaseNoteItems {
  const items =
    labels.length > 0
      ? labels.slice(0, MAX_RELEASE_NOTE_ITEMS_PER_GROUP).map(truncateReleaseNoteItem)
      : noForkChanges
        ? ["No fork changes since the previous build."]
        : [];
  return {
    items,
    totalItems: labels.length > 0 ? labels.length : items.length,
    ...(footer ? { footer } : {}),
  };
}

/**
 * GMACKO releases are written by scripts/gmacko-changelog.ts. The updater reads GitHub's rendered
 * feed, which drops the embedded manifest, so the same notes are recovered from that HTML.
 */
function extractGmackoReleaseNotes(note: string): ExtractedReleaseNoteItems | undefined {
  const decoded = decodeHtmlEntities(note);
  const manifest = parseGmackoChangelogManifest(note) ?? parseGmackoChangelogManifest(decoded);
  if (manifest) return notesFromGmackoManifest(manifest);
  if (!/GMACKO changes/i.test(decoded)) return undefined;
  return notesFromRenderedGmackoChanges(decoded);
}

function extractReleaseNoteItems(note: string | null | undefined): ExtractedReleaseNoteItems {
  if (!note) return { items: [], totalItems: 0 };
  const gmacko = extractGmackoReleaseNotes(note);
  if (gmacko) return gmacko;

  // Generated summaries fold GitHub's full list under this exact <details> block.
  const summaryEnd = note.search(/<details>\s*<summary>\s*Full changelog\s*<\/summary>/i);
  if (summaryEnd >= 0) return extractReleaseNoteSummary(note.slice(0, summaryEnd));
  const items: string[] = [];
  let totalItems = 0;
  for (const rawLine of stripMarkup(note).split("\n")) {
    const item = rawLine
      .trim()
      .replace(/^[-*]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .replace(/\s+/g, " ");
    const normalized = normalizeReleaseNoteLine(item);
    if (normalized === "new contributors" || normalized === "full changelog") break;
    if (/^#{1,6}\s+/.test(item)) continue;
    if (isIgnoredReleaseNoteLine(item)) continue;
    totalItems += 1;
    items.push(truncateReleaseNoteItem(item));
    if (items.length > MAX_RELEASE_NOTE_ITEMS_PER_GROUP) items.shift();
  }
  return { items: items.toReversed(), totalItems };
}

// The update feed dates only the offered version. Nightly and preview versions carry their UTC
// build day; GMACKO stamps are YYYYMMDDHHMM.
const PRERELEASE_BUILD_DAY = /-(?:nightly|preview)\.(\d{4})(\d{2})(\d{2})\.\d+$/;
const GMACKO_BUILD_DAY = /-gmacko\.(\d{4})(\d{2})(\d{2})\d{4}$/;

function resolveReleasedAt(version: string, offeredVersion: string, releaseDate?: string) {
  if (version === offeredVersion && releaseDate) return releaseDate;
  const day = PRERELEASE_BUILD_DAY.exec(version) ?? GMACKO_BUILD_DAY.exec(version);
  return day ? `${day[1]}-${day[2]}-${day[3]}` : undefined;
}

interface NormalizedDesktopUpdateReleaseNotes {
  readonly releaseNotes: ReadonlyArray<DesktopUpdateReleaseNote>;
  readonly omittedReleaseCount: number;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Untagged notes come from the feed entry named by releaseName, which is the newest entry when the
 * offered release is not on the feed's first page. Keep them only when that entry is the offered one.
 */
export function releaseNotesOfOfferedVersion(info: {
  readonly version: string;
  readonly releaseNotes?: unknown;
  readonly releaseName?: string | null | undefined;
}): unknown {
  if (typeof info.releaseNotes !== "string" || !info.releaseName) return info.releaseNotes;
  const namesVersion = new RegExp(`(?:^|[^\\w.-])v?${escapeRegExp(info.version)}(?![\\w.-])`);
  return namesVersion.test(info.releaseName) ? info.releaseNotes : undefined;
}

/** fullChangelog includes all greater semvers, so preview cuts sort above nightlies of the same base version. */
export function normalizeDesktopUpdateReleaseNotes(
  releaseNotes: unknown,
  fallbackVersion: string,
  channel: DesktopUpdateChannel,
  releaseDate?: string,
): NormalizedDesktopUpdateReleaseNotes {
  const rawNotes = (
    typeof releaseNotes === "string"
      ? [{ version: fallbackVersion, note: releaseNotes }]
      : Array.isArray(releaseNotes)
        ? releaseNotes.filter(isElectronReleaseNoteInfo)
        : []
  ).filter((entry) => desktopUpdateChannelOf(entry.version) === channel);

  const normalizedNotes = rawNotes.flatMap((entry) => {
    const note = extractReleaseNoteItems(entry.note);
    if (note.totalItems === 0 && !note.stats) return [];
    const releasedAt = resolveReleasedAt(entry.version, fallbackVersion, releaseDate);
    return [
      {
        version: entry.version,
        ...note,
        ...(releasedAt ? { releasedAt } : {}),
      },
    ];
  });

  return {
    releaseNotes: normalizedNotes.slice(0, MAX_RELEASE_NOTE_GROUPS),
    omittedReleaseCount: Math.max(0, normalizedNotes.length - MAX_RELEASE_NOTE_GROUPS),
  };
}
