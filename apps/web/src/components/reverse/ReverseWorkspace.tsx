import { useEffect, useRef, useState } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { reverseEnvironment } from "~/state/reverse";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { AnalysisPanel } from "./AnalysisPanel";
import { FindingsPanel, type FindingSeed } from "./FindingsPanel";

const FIRMWARE_SOURCES = [
  { value: "imported", label: "Imported file" },
  { value: "vendor", label: "Vendor image" },
  { value: "flash-read", label: "Flash acquisition" },
  { value: "build", label: "Build output" },
] as const;
type FirmwareSource = (typeof FIRMWARE_SOURCES)[number]["value"];

export function ReverseWorkspace({
  threadRef,
  projectId,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly projectId: string | null;
}) {
  if (!projectId)
    return <p className="p-4 text-sm">Open a project thread to begin a firmware investigation.</p>;
  return (
    <ProjectWorkspace
      key={`${threadRef.environmentId}:${projectId}`}
      threadRef={threadRef}
      projectId={projectId}
    />
  );
}
function ProjectWorkspace({
  threadRef,
  projectId,
}: {
  threadRef: ScopedThreadRef;
  projectId: string;
}) {
  const [path, setPath] = useState(""),
    [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  // Unsaved linkage edits for one investigation; otherwise the form shows what is saved.
  const [draft, setDraft] = useState<{ id: string; veritas?: string; board?: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [findingSeed, setFindingSeed] = useState<FindingSeed | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<FirmwareSource>("imported"),
    [published, setPublished] = useState<{ investigationId: string; artifactId: string } | null>(
      null,
    );
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const target = { environmentId: threadRef.environmentId, input: { projectId } };
  const list = useEnvironmentQuery(reverseEnvironment.list(target));
  const toolchain = useEnvironmentQuery(
    reverseEnvironment.toolchain({ environmentId: threadRef.environmentId, input: {} }),
  );
  const toolsNeedingSetup = (toolchain.data?.tools ?? []).filter((tool) => tool.status !== "ready");
  const investigations = list.data?.investigations ?? [],
    artifacts = list.data?.artifacts ?? [];
  const active = investigations.find((item) => item.id === selected) ?? investigations[0];
  const parent = active?.parentInvestigationId
    ? investigations.find((item) => item.id === active.parentInvestigationId)
    : undefined;
  const editing = draft !== null && draft.id === active?.id ? draft : null;
  const veritas = editing?.veritas ?? active?.veritasProjectId ?? "";
  const board = editing?.board ?? active?.boardRevisionId ?? "";
  // Only edited fields are sent, so a save never overwrites a link someone else just changed.
  const editLink = (change: { veritas?: string; board?: string }) => {
    if (active) setDraft({ ...editing, id: active.id, ...change });
  };
  // Strings can be megabytes; fetch them only while their section is open.
  const [stringsOpen, setStringsOpen] = useState(false);
  const strings = useEnvironmentQuery(
    active && stringsOpen
      ? reverseEnvironment.strings({
          environmentId: threadRef.environmentId,
          input: { projectId, investigationId: active.id, minLength: 4 },
        })
      : null,
  );
  const importFile = useAtomCommand(reverseEnvironment.importFile, { reportFailure: false });
  const link = useAtomCommand(reverseEnvironment.link, { reportFailure: false });
  const remove = useAtomCommand(reverseEnvironment.remove, { reportFailure: false });
  const publish = useAtomCommand(reverseEnvironment.publish, { reportFailure: false });
  async function importFirmware() {
    if (busy || !path.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await importFile({
        environmentId: threadRef.environmentId,
        input: { projectId, relativePath: path.trim() },
      });
      if (!alive.current) return;
      if (response._tag === "Failure") throw squashAtomCommandFailure(response);
      setSelected(response.value.investigation.id);
      setPath("");
      list.refresh();
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function deleteInvestigation(investigationId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await remove({
        environmentId: threadRef.environmentId,
        input: { projectId, investigationId },
      });
      if (!alive.current) return;
      if (response._tag === "Failure") throw squashAtomCommandFailure(response);
      setSelected(null);
      setConfirmDelete(null);
      list.refresh();
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function saveLink() {
    if (!active || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await link({
        environmentId: threadRef.environmentId,
        input: {
          projectId,
          investigationId: active.id,
          // An emptied field clears the saved link; untouched fields are left out.
          ...(editing?.veritas === undefined
            ? {}
            : { veritasProjectId: editing.veritas.trim() || null }),
          ...(editing?.board === undefined
            ? {}
            : { boardRevisionId: editing.board.trim() || null }),
        },
      });
      if (!alive.current) return;
      if (response._tag === "Failure") throw squashAtomCommandFailure(response);
      setDraft(null);
      list.refresh();
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function publishFirmware() {
    if (!active || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await publish({
        environmentId: threadRef.environmentId,
        input: {
          projectId,
          investigationId: active.id,
          source,
        },
      });
      if (!alive.current) return;
      if (response._tag === "Failure") throw squashAtomCommandFailure(response);
      setPublished({ investigationId: active.id, artifactId: response.value.artifactId });
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section
      aria-label="Reverse engineering workspace"
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
    >
      <header className="border-b border-border p-3">
        <h2 className="text-sm font-semibold">Reverse Workbench</h2>
        <p className="text-xs text-muted-foreground">Firmware · code · hardware · evidence</p>
        {toolchain.data && (
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              {toolsNeedingSetup.length
                ? `Toolchain: ${toolsNeedingSetup.length} of ${toolchain.data.tools.length} tools need setup`
                : "Toolchain: everything is ready"}
            </summary>
            <ul className="mt-2 space-y-2">
              {toolchain.data.tools.map((tool) => (
                <li key={tool.id}>
                  <span className="font-medium">{tool.label}</span>{" "}
                  <span className={tool.status === "ready" ? "text-success" : "text-warning"}>
                    {tool.status}
                  </span>
                  <span className="text-muted-foreground">
                    {" "}
                    · needed for {tool.requiredFor.join(", ")}
                  </span>
                  <p className="break-all text-muted-foreground">{tool.detail}</p>
                  {tool.status !== "ready" && <p>{tool.hint}</p>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </header>
      <form
        className="flex gap-2 border-b border-border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void importFirmware();
        }}
      >
        <Input
          aria-label="Firmware path relative to the project"
          placeholder="Firmware path relative to this environment’s project"
          value={path}
          onChange={(event) => setPath(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={busy || !path.trim()}>
          Import firmware
        </Button>
      </form>
      {(error || list.error) && (
        <p role="alert" className="p-3 text-xs text-destructive">
          {error ?? list.error}
        </p>
      )}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          aria-label="Firmware investigations"
          className="w-44 shrink-0 overflow-auto border-r border-border p-2"
        >
          {!investigations.length && (
            <p className="text-xs text-muted-foreground">
              Import an ELF, PE or raw firmware image.
            </p>
          )}
          {investigations.map((item) => (
            <Button
              key={item.id}
              className="mb-1 w-full justify-start overflow-hidden"
              variant={active?.id === item.id ? "secondary" : "ghost"}
              size="sm"
              disabled={busy}
              onClick={() => {
                setSelected(item.id);
                setFilter("");
                setConfirmDelete(null);
              }}
              title={item.artifactSha256}
            >
              <span className="truncate">
                {artifacts.find((a) => a.sha256 === item.artifactSha256)?.filename ??
                  item.artifactSha256.slice(0, 12)}
              </span>
            </Button>
          ))}
        </aside>
        <div className="min-w-0 flex-1 overflow-auto">
          {active && (
            <>
              <div className="flex items-center gap-2 border-b border-border p-3">
                <div className="min-w-0 flex-1 text-xs">
                  <p className="break-all font-mono">SHA-256 {active.artifactSha256}</p>
                  {parent && (
                    <p className="text-muted-foreground">
                      Extracted from{" "}
                      <Button size="xs" variant="link" onClick={() => setSelected(parent.id)}>
                        {artifacts.find((a) => a.sha256 === parent.artifactSha256)?.filename ??
                          parent.artifactSha256.slice(0, 12)}
                      </Button>
                    </p>
                  )}
                </div>
                {confirmDelete === active.id ? (
                  <>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => void deleteInvestigation(active.id)}
                    >
                      Delete
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setConfirmDelete(null)}
                    >
                      Keep
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost-destructive"
                    disabled={busy}
                    onClick={() => setConfirmDelete(active.id)}
                  >
                    Delete investigation
                  </Button>
                )}
              </div>
              <AnalysisPanel
                key={active.id}
                threadRef={threadRef}
                projectId={projectId}
                investigationId={active.id}
                onOpenInvestigation={(id) => {
                  setSelected(id);
                  list.refresh();
                }}
                onRecordFinding={(draft) =>
                  setFindingSeed({ ...draft, nonce: (findingSeed?.nonce ?? 0) + 1 })
                }
              />
              <FindingsPanel
                key={`findings:${active.id}`}
                threadRef={threadRef}
                projectId={projectId}
                investigationId={active.id}
                artifactSha256={active.artifactSha256}
                findings={(list.data?.findings ?? []).filter(
                  (finding) => finding.investigationId === active.id,
                )}
                seed={findingSeed}
                onChanged={() => list.refresh()}
              />
              <details
                className="border-b border-border p-3"
                onToggle={(event) => setStringsOpen(event.currentTarget.open)}
              >
                <summary className="cursor-pointer text-xs font-medium">
                  Strings and file offsets
                </summary>
                <Input
                  aria-label="Filter extracted strings"
                  className="my-2"
                  placeholder="Find URLs, log messages, protocol names…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  ASCII scan, first 32 MiB, at most 2,000 matches; showing at most 500 filtered
                  rows. {strings.data?.truncated ? "Scan truncated." : ""}
                </p>
                {strings.error && <p role="alert">{strings.error}</p>}
                <div className="max-h-64 overflow-auto font-mono text-xs">
                  {(strings.data?.strings ?? [])
                    .filter((row) => row.value.toLowerCase().includes(filter.toLowerCase()))
                    .slice(0, 500)
                    .map((row) => (
                      <div key={row.offset} className="flex gap-3 border-b border-border py-1">
                        <span>0x{row.offset.toString(16)}</span>
                        <span className="break-all">{row.value}</span>
                      </div>
                    ))}
                </div>
              </details>
              <form
                className="space-y-2 p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveLink();
                }}
              >
                <h3 className="text-xs font-medium">Veritas linkage</h3>
                <Input
                  aria-label="Veritas project id"
                  placeholder="Veritas project ID"
                  value={veritas}
                  onChange={(e) => editLink({ veritas: e.target.value })}
                />
                <Input
                  aria-label="Board revision id"
                  placeholder="Board revision ID"
                  value={board}
                  onChange={(e) => editLink({ board: e.target.value })}
                />
                <Button type="submit" size="sm" variant="outline" disabled={busy}>
                  Save linkage
                </Button>
                <p className="text-xs text-muted-foreground">
                  Linking identifiers does not publish firmware or qualify hardware.
                </p>
              </form>
              <div className="space-y-2 p-3">
                <h3 className="text-xs font-medium">Veritas registration</h3>
                <div className="flex items-center gap-2">
                  {parent ? (
                    <p className="text-xs text-muted-foreground">
                      Registered as extracted from its parent; register the parent first.
                    </p>
                  ) : (
                    <Select
                      value={source}
                      disabled={busy}
                      onValueChange={(value) => {
                        if (value !== null) setSource(value);
                      }}
                    >
                      <SelectTrigger size="xs" className="w-40" aria-label="Firmware source">
                        <SelectValue>
                          {FIRMWARE_SOURCES.find((option) => option.value === source)?.label}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        {FIRMWARE_SOURCES.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void publishFirmware()}
                  >
                    Register in Veritas
                  </Button>
                </div>
                {published?.investigationId === active.id && (
                  <p role="status" className="text-xs text-muted-foreground">
                    Registered artifact {published.artifactId}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Publishes the digest, size, provenance and saved board revision; firmware bytes
                  stay on this environment.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
