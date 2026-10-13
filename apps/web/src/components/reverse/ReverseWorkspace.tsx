import type { ScopedThreadRef, ReverseAnalysisResult, ReverseEmulateResult } from "@t3tools/contracts";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Binary, Cpu, FileArchive, FolderSearch, Link2, Search, ShieldCheck } from "lucide-react";
import { reverseEnvironment } from "~/state/reverse";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";

export function ReverseWorkspace({
  threadRef,
  projectId,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly projectId: string | null;
}) {
  const [relativePath, setRelativePath] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stringFilter, setStringFilter] = useState("");
  const [minLength, setMinLength] = useState(4);
  const [veritasProjectId, setVeritasProjectId] = useState("");
  const [boardRevisionId, setBoardRevisionId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<ReverseAnalysisResult | null>(null);
  const [emulation, setEmulation] = useState<ReverseEmulateResult | null>(null);
  const [selectedFunction, setSelectedFunction] = useState<string | null>(null);

  const target = projectId
    ? { environmentId: threadRef.environmentId, input: { projectId } }
    : null;
  const list = useEnvironmentQuery(target ? reverseEnvironment.list(target) : null);
  const artifacts = list.data?.artifacts ?? [];
  const investigations = list.data?.investigations ?? [];
  const active = investigations.find((v) => v.id === selectedId) ?? investigations[0] ?? null;

  useEffect(() => {
    if (active && active.id !== selectedId) setSelectedId(active.id);
  }, [active, selectedId]);

  const strings = useEnvironmentQuery(
    projectId && active
      ? reverseEnvironment.strings({
          environmentId: threadRef.environmentId,
          input: { projectId, investigationId: active.id, minLength },
        })
      : null,
  );

  const filteredStrings = useMemo(() => {
    const query = stringFilter.toLowerCase();
    return (strings.data?.strings ?? []).filter((s) =>
      query === "" || s.value.toLowerCase().includes(query),
    ).slice(0, 500);
  }, [strings.data, stringFilter]);

  const importFile = useAtomCommand(reverseEnvironment.importFile, { reportFailure: false });
  const link = useAtomCommand(reverseEnvironment.link, { reportFailure: false });
  const analyze = useAtomCommand(reverseEnvironment.analyze, { reportFailure: false });
  const emulate = useAtomCommand(reverseEnvironment.emulate, { reportFailure: false });

  async function runAnalysis(kind: "ghidra" | "binwalk" | "gadgets") {
    if (!active || !projectId) return;
    setBusy(true); setError(null); setAnalysis(null);
    try {
      const result = await analyze({ environmentId: threadRef.environmentId, input: { projectId, investigationId: active.id, kind } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setAnalysis(result.value); setSelectedFunction(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function runEmulation() {
    if (!active || !projectId) return;
    setBusy(true); setError(null); setEmulation(null);
    try {
      const result = await emulate({ environmentId: threadRef.environmentId, input: { projectId, investigationId: active.id, machine: "lm3s6965evb" } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setEmulation(result.value);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function onImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId || !relativePath.trim()) return;
    setBusy(true); setError(null);
    try {
      const response = await importFile({
        environmentId: threadRef.environmentId,
        input: { projectId, relativePath: relativePath.trim() },
      });
      if (response._tag === "Failure") throw squashAtomCommandFailure(response);
      setSelectedId(response.value.investigation.id);
      setRelativePath("");
      list.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }

  async function onLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId || !active) return;
    setBusy(true); setError(null);
    try {
      const response = await link({
        environmentId: threadRef.environmentId,
        input: {
          projectId,
          investigationId: active.id,
          ...(veritasProjectId.trim() ? { veritasProjectId: veritasProjectId.trim() } : {}),
          ...(boardRevisionId.trim() ? { boardRevisionId: boardRevisionId.trim() } : {}),
        },
      });
      if (response._tag === "Failure") throw squashAtomCommandFailure(response);
      list.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }

  return (
    <section aria-label="Reverse engineering workspace" className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Cpu className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Reverse Workbench</h2>
        <span className="ml-auto text-xs text-muted-foreground">Firmware investigations</span>
      </header>
      {projectId === null ? (
        <p className="p-5 text-sm text-muted-foreground">Open a project thread to start a reverse-engineering investigation.</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <form onSubmit={(e) => void onImport(e)} className="flex items-center gap-2 border-b border-border p-3">
            <FileArchive className="size-4 shrink-0 text-muted-foreground" />
            <input
              aria-label="Firmware path relative to the project"
              value={relativePath}
              onChange={(e) => setRelativePath(e.target.value)}
              placeholder="Firmware path relative to project"
              className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1.5 font-mono text-xs"
            />
            <button type="submit" disabled={busy || !relativePath.trim()} className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50">
              Import
            </button>
          </form>
          {error && <p role="alert" className="border-b border-border px-4 py-2 text-xs text-destructive">{error}</p>}
          {list.error && <p role="alert" className="p-4 text-xs text-destructive">{list.error}</p>}
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(9rem,32%)_minmax(0,1fr)]">
            <aside aria-label="Firmware investigations" className="min-w-0 border-r border-border">
              <div className="flex items-center gap-2 border-b border-border p-3 text-xs font-medium">
                <FolderSearch className="size-3.5" /> Firmware
                <span className="ml-auto text-muted-foreground">{investigations.length}</span>
              </div>
              {investigations.length === 0 && <p className="p-3 text-xs text-muted-foreground">Import an ELF or firmware image to begin.</p>}
              {investigations.map((item) => {
                const artifact = artifacts.find((a) => a.sha256 === item.artifactSha256);
                return (
                  <button key={item.id} type="button" onClick={() => setSelectedId(item.id)}
                    aria-pressed={active?.id === item.id}
                    className={`block w-full border-b border-border px-3 py-2 text-left text-xs hover:bg-accent ${active?.id === item.id ? "bg-accent/60" : ""}`}>
                    <div className="truncate font-medium">{artifact?.filename ?? "Firmware"}</div>
                    <div className="truncate font-mono text-[10px] text-muted-foreground">{item.artifactSha256.slice(0, 16)}</div>
                  </button>
                );
              })}
            </aside>
            <div className="flex min-h-0 flex-col">
              {active ? (
                <>
                  <div className="border-b border-border p-3">
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold"><Cpu className="size-3.5" /> Binary analysis</div>
                    <div className="flex flex-wrap gap-1.5">
                      {(["ghidra", "binwalk", "gadgets"] as const).map(kind => (
                        <button key={kind} type="button" disabled={busy} onClick={() => void runAnalysis(kind)}
                          className="rounded border border-border px-2 py-1.5 text-xs capitalize hover:bg-accent disabled:opacity-50">
                          {kind === "gadgets" ? "ROP/JOP gadgets" : kind}
                        </button>
                      ))}
                      <button type="button" disabled={busy} onClick={() => void runEmulation()}
                        className="rounded border border-border px-2 py-1.5 text-xs hover:bg-accent disabled:opacity-50">
                        QEMU (LM3S6965EVB)
                      </button>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">Runs supported local tools on the owning T3 environment. QEMU results are simulation observations, not hardware validation.</p>
                  </div>
                  {(analysis || emulation) && (
                    <div className="max-h-72 overflow-y-auto border-b border-border p-3">
                      {analysis && <>
                        <div className="text-xs font-semibold uppercase">{analysis.kind} results</div>
                        <p className="mt-1 whitespace-pre-wrap break-all font-mono text-xs">{analysis.output.slice(0, 25000)}</p>
                        {analysis.truncated && <p className="text-xs text-muted-foreground">Output truncated.</p>}
                        {analysis.gadgets?.map((g, index) => (
                          <div key={g.address + index} className="flex gap-2 border-b border-border/40 py-1 font-mono text-xs">
                            <span className="shrink-0 text-muted-foreground">{g.address}</span>
                            <span className="shrink-0 uppercase">{g.kind}</span>
                            <span>{g.instructions}</span>
                          </div>
                        ))}
                        {analysis.functions && (
                          <div className="grid grid-cols-[minmax(6rem,35%)_minmax(0,1fr)] border border-border">
                            <div className="max-h-48 overflow-y-auto border-r border-border">
                              {analysis.functions.map(fn => (
                                <button type="button" key={fn.address} onClick={()=>setSelectedFunction(fn.address)}
                                  className="block w-full truncate border-b border-border/40 px-2 py-1 text-left font-mono text-xs hover:bg-accent">{fn.name} · {fn.address}</button>
                              ))}
                            </div>
                            <div className="max-h-48 overflow-y-auto p-2">
                              {analysis.functions.filter(fn=>fn.address === (selectedFunction ?? analysis.functions?.[0]?.address)).map(fn=>(
                                <div key={fn.address}>
                                  <h4 className="text-xs font-medium">{fn.name}</h4>
                                  <pre className="overflow-x-auto whitespace-pre text-xs">{fn.pseudocode}</pre>
                                  <details><summary className="cursor-pointer text-xs">Disassembly</summary>
                                    <pre className="overflow-x-auto whitespace-pre text-xs">{fn.instructions.map(ins=>ins.address + "  " + ins.text).join("\n")}</pre>
                                  </details>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>}
                      {emulation && (
                        <div><div className="text-xs font-semibold">QEMU · {emulation.outcome}</div>
                          <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">{emulation.output}</pre></div>
                      )}
                    </div>
                  )}
                  <div className="border-b border-border p-3">
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium"><Binary className="size-3.5" /> Binary strings</div>
                    <div className="flex gap-2">
                      <label className="flex min-w-0 flex-1 items-center gap-1 rounded border border-border px-2">
                        <Search className="size-3.5 text-muted-foreground" />
                        <input aria-label="Filter extracted strings" className="min-w-0 flex-1 bg-transparent py-1.5 text-xs outline-none"
                          placeholder="Filter strings" value={stringFilter} onChange={e=>setStringFilter(e.target.value)} />
                      </label>
                      <select aria-label="Minimum string length" value={minLength} onChange={e=>setMinLength(Number(e.target.value))}
                        className="rounded border border-border bg-background px-1 text-xs">
                        {[4,6,8,12].map(n=><option key={n} value={n}>{n}+ chars</option>)}
                      </select>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      ASCII scan of first 32 MiB; max 2,000 results.
                      {strings.data?.truncated ? " Results truncated." : ""}
                    </p>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {strings.error && <p className="p-3 text-xs text-destructive">{strings.error}</p>}
                    {filteredStrings.map((item) => (
                      <div key={item.offset} className="flex gap-3 border-b border-border/60 px-3 py-1 font-mono text-xs">
                        <span className="shrink-0 text-muted-foreground">0x{item.offset.toString(16).padStart(8,"0")}</span>
                        <span className="min-w-0 break-all">{item.value}</span>
                      </div>
                    ))}
                  </div>
                  <form onSubmit={e=>void onLink(e)} className="border-t border-border p-3">
                    <div className="mb-2 flex items-center gap-2 text-xs"><ShieldCheck className="size-3.5" /> Veritas evidence linkage</div>
                    <div className="flex gap-2">
                      <input aria-label="Veritas project id" value={veritasProjectId} onChange={e=>setVeritasProjectId(e.target.value)}
                        placeholder={active.veritasProjectId ?? "Veritas project ID"}
                        className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs" />
                      <input aria-label="Board revision id" value={boardRevisionId} onChange={e=>setBoardRevisionId(e.target.value)}
                        placeholder={active.boardRevisionId ?? "Board revision ID"}
                        className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs" />
                      <button type="submit" disabled={busy} aria-label="Save Veritas linkage"
                        className="rounded border border-border p-1.5 hover:bg-accent disabled:opacity-50"><Link2 className="size-3.5" /></button>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">Local linkage only until Veritas evidence publication is configured.</p>
                  </form>
                </>
              ) : (
                <p className="p-5 text-sm text-muted-foreground">Select or import firmware to inspect its strings and provenance.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
