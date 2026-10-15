import { useEffect, useRef, useState } from "react";
import type {
  ScopedThreadRef,
  ReverseAnalysisInput,
  ReverseAnalysisResult,
  ReverseGhidraFunction,
  ReverseGhidraOperation,
  ReverseEmulateResult,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { reverseEnvironment } from "~/state/reverse";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

/** Mounted with an investigation key: responses can never migrate to another firmware tab. */
// Rows rendered per function; the bridge may return more for very large functions.
const MAX_INSTRUCTION_ROWS = 1000;

export function AnalysisPanel({
  threadRef,
  projectId,
  investigationId,
  onRecordFinding,
  onOpenInvestigation,
}: {
  threadRef: ScopedThreadRef;
  projectId: string;
  investigationId: string;
  /** Starts a finding about the given function in the findings panel. */
  onRecordFinding: (draft: { title: string; address: string }) => void;
  /** Shows an investigation this panel just created, such as one opened from an extraction. */
  onOpenInvestigation: (investigationId: string) => void;
}) {
  const importExtracted = useAtomCommand(reverseEnvironment.importExtracted, {
    reportFailure: false,
  });
  async function openExtracted(receiptId: string, path: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await importExtracted({
        environmentId: threadRef.environmentId,
        input: { projectId, investigationId, receiptId, path },
      });
      if (!alive.current) return;
      if (response._tag === "Failure") throw squashAtomCommandFailure(response);
      onOpenInvestigation(response.value.investigation.id);
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const analyze = useAtomCommand(reverseEnvironment.analyze, { reportFailure: false });
  const emulate = useAtomCommand(reverseEnvironment.emulate, { reportFailure: false });
  const alive = useRef(true),
    request = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current++;
    };
  }, []);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [tokensOpen, setTokensOpen] = useState(false);
  const [result, setResult] = useState<ReverseAnalysisResult | null>(null),
    [emulation, setEmulation] = useState<ReverseEmulateResult | null>(null);
  const [functions, setFunctions] = useState<readonly ReverseGhidraFunction[]>([]),
    [selected, setSelected] = useState<ReverseGhidraFunction | null>(null);
  const [cursor, setCursor] = useState<number | undefined>(),
    [filter, setFilter] = useState("");
  const [languageId, setLanguageId] = useState(""),
    [imageBase, setImageBase] = useState(""),
    [rawProfile, setRawProfile] = useState("");
  const [address, setAddress] = useState(""),
    [newName, setNewName] = useState(""),
    [comment, setComment] = useState("");
  const [highlight, setHighlight] = useState<string | null>(null);
  const [machine, setMachine] = useState<"lm3s6965evb" | "mps2-an385">("lm3s6965evb");
  async function run(kind: ReverseAnalysisInput["kind"], operation?: ReverseGhidraOperation) {
    if (busy) return;
    const sequence = ++request.current;
    setBusy(true);
    setError(null);
    try {
      const profiles: Record<
        string,
        Pick<ReverseAnalysisInput, "rawArch" | "rawMode" | "rawEndian">
      > = {
        thumb: { rawArch: "arm", rawMode: "thumb", rawEndian: "little" },
        arm: { rawArch: "arm", rawMode: "arm", rawEndian: "little" },
        arm64: { rawArch: "arm64", rawMode: "arm", rawEndian: "little" },
        mips: { rawArch: "mips", rawMode: "32", rawEndian: "little" },
        x64: { rawArch: "x86", rawMode: "64", rawEndian: "little" },
      };
      if (kind === "gadgets" && rawProfile && !profiles[rawProfile])
        throw new Error(
          "Raw profile must be thumb, arm, arm64, mips or x64; leave empty for ELF/PE.",
        );
      const response = await analyze({
        environmentId: threadRef.environmentId,
        input: {
          projectId,
          investigationId,
          kind,
          ...(kind === "gadgets" ? (profiles[rawProfile] ?? {}) : {}),
          ...(kind === "ghidra"
            ? {
                ghidra: {
                  ...(languageId ? { languageId } : {}),
                  ...(imageBase ? { imageBase } : {}),
                  ...operation,
                },
              }
            : {}),
        },
      });
      if (!alive.current || sequence !== request.current) return;
      if (response._tag === "Failure") throw squashAtomCommandFailure(response);
      setResult(response.value);
      if (kind === "ghidra") {
        const rows = response.value.functions ?? [];
        if (!operation || operation.action === "list") {
          setFunctions(rows);
          setCursor(response.value.nextCursor);
        } else if (rows[0]) {
          setSelected(rows[0]);
          setNewName(rows[0].name);
          setAddress(rows[0].address);
          setHighlight(null);
          setFunctions((old) => old.map((fn) => (fn.address === rows[0]!.address ? rows[0]! : fn)));
        } else if (operation.action === "close") {
          setSelected(null);
          setFunctions([]);
          setCursor(undefined);
        }
      }
    } catch (cause) {
      if (alive.current && sequence === request.current) setError(String(cause));
    } finally {
      if (alive.current && sequence === request.current) setBusy(false);
    }
  }
  async function observe() {
    if (busy) return;
    const sequence = ++request.current;
    setBusy(true);
    setError(null);
    try {
      const response = await emulate({
        environmentId: threadRef.environmentId,
        input: { projectId, investigationId, machine },
      });
      if (!alive.current || sequence !== request.current) return;
      if (response._tag === "Failure") throw squashAtomCommandFailure(response);
      setEmulation(response.value);
    } catch (cause) {
      if (alive.current && sequence === request.current) setError(String(cause));
    } finally {
      if (alive.current && sequence === request.current) setBusy(false);
    }
  }
  const go = (at: string) => void run("ghidra", { action: "function", address: at });
  return (
    <section aria-label="Firmware analysis" className="space-y-3 border-b border-border p-3">
      <div className="flex flex-wrap gap-2">
        {(["ghidra", "binwalk", "unblob", "gadgets", "posture", "rea"] as const).map((kind) => (
          <Button
            key={kind}
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void run(kind)}
          >
            {kind === "gadgets" ? "ROP / JOP / COP" : kind}
          </Button>
        ))}
      </div>
      <details>
        <summary className="cursor-pointer text-xs">Raw image loading and gadget profile</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <Input
            aria-label="Ghidra language ID"
            placeholder="Ghidra language ID (blank: detect)"
            value={languageId}
            disabled={busy}
            onChange={(e) => setLanguageId(e.target.value)}
          />
          <Input
            aria-label="Image base address"
            placeholder="Image base, e.g. 0x08000000"
            value={imageBase}
            disabled={busy}
            onChange={(e) => setImageBase(e.target.value)}
          />
          <Input
            aria-label="Raw gadget profile"
            placeholder="Gadget profile: thumb / arm / arm64 / mips / x64"
            value={rawProfile}
            disabled={busy}
            onChange={(e) => setRawProfile(e.target.value)}
          />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Raw images require known load addresses and entry points. CPU support does not imply a
          complete device model.
        </p>
      </details>
      {busy && (
        <p role="status" className="text-xs">
          Analysis running on the owning environment…
        </p>
      )}
      {error && (
        <p role="alert" className="whitespace-pre-wrap break-all text-xs text-destructive">
          {error}
        </p>
      )}
      {result && (
        <div className="space-y-2">
          <p className="text-xs">
            {result.kind} · {result.toolVersion ?? "version unreported"} · receipt{" "}
            {result.receiptId ?? "not supplied"}
            {result.truncated ? " · partial result" : ""}
          </p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">
            {result.output.slice(0, 40000)}
          </pre>
          {result.extracted?.map((file) => (
            <div
              key={file.path}
              className="flex items-center gap-2 border-b border-border font-mono text-xs"
            >
              <span className="min-w-0 flex-1 break-all">
                {file.path} · {file.bytes} bytes · {file.sha256?.slice(0, 16)}
              </span>
              {result.receiptId && (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void openExtracted(result.receiptId!, file.path)}
                >
                  Open
                </Button>
              )}
            </div>
          ))}
          {result.gadgets?.map((g, i) => (
            <div
              key={g.address + i}
              className="flex gap-2 border-b border-border py-1 font-mono text-xs"
            >
              <span>{g.address}</span>
              <span>{g.kind.toUpperCase()}</span>
              <span>{g.instructions}</span>
            </div>
          ))}
        </div>
      )}
      {functions.length > 0 && (
        <>
          <div className="flex gap-2">
            <Input
              aria-label="Filter functions"
              placeholder="Filter this function page"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy || cursor === undefined}
              onClick={() => void run("ghidra", { action: "list", cursor })}
            >
              Next page
            </Button>
          </div>
          <div className="grid min-h-60 gap-2 lg:grid-cols-[minmax(10rem,25%)_minmax(0,1fr)]">
            <div className="max-h-80 overflow-auto border border-border">
              {functions
                .filter((fn) => fn.name.toLowerCase().includes(filter.toLowerCase()))
                .map((fn) => (
                  <Button
                    key={fn.address}
                    size="compact"
                    variant="ghost"
                    className="w-full justify-start"
                    disabled={busy}
                    onClick={() => go(fn.address)}
                  >
                    <span className="truncate font-mono">
                      {fn.name} · {fn.address}
                    </span>
                  </Button>
                ))}
            </div>
            <div className="min-w-0">
              {selected ? (
                <>
                  <div className="mb-2 flex gap-2">
                    <Input
                      aria-label="New function name"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                    />
                    <Button
                      size="sm"
                      disabled={busy || !newName}
                      onClick={() =>
                        void run("ghidra", {
                          action: "rename",
                          address: selected.address,
                          expectedName: selected.name,
                          name: newName,
                        })
                      }
                    >
                      Apply rename
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onRecordFinding({ title: `${selected.name}: `, address: selected.address })
                      }
                    >
                      Record finding
                    </Button>
                  </div>
                  <pre className="max-h-96 overflow-auto border border-border p-2 text-xs">
                    {selected.pseudocode}
                  </pre>
                  <details
                    className="mt-2"
                    onToggle={(event) => setTokensOpen(event.currentTarget.open)}
                  >
                    <summary className="cursor-pointer text-xs">Address-linked tokens</summary>
                    <div className="max-h-32 overflow-auto font-mono text-xs">
                      {/* Thousands of token buttons; mount them only while the section is open. */}
                      {tokensOpen &&
                        selected.tokens?.map((token, i) =>
                          token.address ? (
                            <Button
                              key={i}
                              size="micro"
                              variant="ghost"
                              title={token.address}
                              onClick={() => setHighlight(token.address!)}
                            >
                              {token.text}
                            </Button>
                          ) : (
                            <span key={i}>{token.text}</span>
                          ),
                        )}
                    </div>
                  </details>
                  {selected.instructions.length > MAX_INSTRUCTION_ROWS && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Showing the first {MAX_INSTRUCTION_ROWS} of {selected.instructions.length}{" "}
                      instructions.
                    </p>
                  )}
                  <div className="mt-2 max-h-64 overflow-auto border border-border font-mono text-xs">
                    {selected.instructions.slice(0, MAX_INSTRUCTION_ROWS).map((ins) => (
                      <div
                        key={ins.address}
                        className={highlight === ins.address ? "bg-accent px-2 py-1" : "px-2 py-1"}
                      >
                        <span>
                          {ins.address} {ins.bytes} {ins.text}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div className="text-xs">
                      Calls
                      {selected.callees?.map((fn) => (
                        <Button
                          key={fn.address}
                          variant="ghost"
                          size="compact"
                          className="w-full justify-start"
                          disabled={busy}
                          onClick={() => go(fn.address)}
                        >
                          {fn.name}
                        </Button>
                      ))}
                    </div>
                    <div className="text-xs">
                      Incoming references
                      {selected.xrefs?.map((ref, i) => (
                        <Button
                          key={i}
                          variant="ghost"
                          size="compact"
                          className="w-full justify-start"
                          disabled={busy}
                          onClick={() => go(ref.address)}
                        >
                          {ref.address} · {ref.type}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Input
                      aria-label="Analysis comment"
                      maxLength={8192}
                      placeholder="Reviewed analysis comment"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run("ghidra", {
                          action: "comment",
                          address: selected.address,
                          comment,
                        })
                      }
                    >
                      Save comment
                    </Button>
                  </div>
                </>
              ) : (
                <p className="p-3 text-xs text-muted-foreground">
                  Choose a function to decompile it in the live session.
                </p>
              )}
            </div>
          </div>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Navigate to address"
          placeholder="Function / instruction address 0x…"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <Button size="sm" variant="outline" disabled={busy || !address} onClick={() => go(address)}>
          Go
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void run("ghidra", { action: "close" })}
        >
          Close Ghidra session
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs">QEMU machine</span>
        {(["lm3s6965evb", "mps2-an385"] as const).map((item) => (
          <Button
            size="compact"
            variant={machine === item ? "secondary" : "outline"}
            key={item}
            disabled={busy}
            aria-pressed={machine === item}
            onClick={() => setMachine(item)}
          >
            {item}
          </Button>
        ))}
        <Button size="sm" disabled={busy} onClick={() => void observe()}>
          Observe five seconds
        </Button>
      </div>
      {emulation && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">
          QEMU · {emulation.outcome} · {emulation.receiptId}
          {"\n"}
          {emulation.output}
        </pre>
      )}
      <p className="text-xs text-muted-foreground">
        Syntactic gadgets are candidates, not proof of exploitability. QEMU observations never count
        as physical qualification. Native analyzers require a configured isolated worker.
      </p>
    </section>
  );
}
