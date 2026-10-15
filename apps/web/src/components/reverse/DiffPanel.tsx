import { useEffect, useRef, useState } from "react";
import type { ReverseDiffResult, ScopedThreadRef } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { reverseEnvironment } from "~/state/reverse";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

/** Compares the active investigation's functions with another build's. */
export function DiffPanel({
  threadRef,
  projectId,
  investigationId,
  others,
}: {
  threadRef: ScopedThreadRef;
  projectId: string;
  investigationId: string;
  others: ReadonlyArray<{ id: string; label: string }>;
}) {
  const diff = useAtomCommand(reverseEnvironment.diff, { reportFailure: false });
  const [other, setOther] = useState<string | null>(null),
    [result, setResult] = useState<ReverseDiffResult | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const selected = others.find((item) => item.id === other) ?? null;

  async function compare() {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await diff({
        environmentId: threadRef.environmentId,
        input: {
          projectId,
          leftInvestigationId: investigationId,
          rightInvestigationId: selected.id,
        },
      });
      if (!alive.current) return;
      if (response._tag === "Failure") throw squashAtomCommandFailure(response);
      setResult(response.value);
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  if (!others.length) return null;
  return (
    <section aria-label="Compare firmware" className="space-y-2 border-b border-border p-3">
      <h3 className="text-xs font-medium">Compare with another build</h3>
      <div className="flex items-center gap-2">
        <Select
          value={other}
          disabled={busy}
          onValueChange={(value) => {
            setOther(value);
            setResult(null);
          }}
        >
          <SelectTrigger size="xs" className="w-48" aria-label="Investigation to compare with">
            <SelectValue>{selected?.label ?? "Choose an investigation"}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {others.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !selected}
          onClick={() => void compare()}
        >
          {busy ? "Comparing…" : "Compare"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Opens both builds in Ghidra; the first comparison of a build can take a few minutes.
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {result && (
        <div className="space-y-1 text-xs">
          <p>
            {result.identical} identical · {result.relocated} relocated · {result.changed} changed ·{" "}
            {result.added} added · {result.removed} removed
            {result.truncated ? " · partial" : ""}
          </p>
          <div className="max-h-64 overflow-auto border border-border font-mono">
            {result.functions.map((row) => (
              <div
                key={`${row.status}:${row.left?.address ?? ""}:${row.right?.address ?? ""}`}
                className="flex gap-2 border-b border-border px-2 py-1"
              >
                <span className="w-20 shrink-0">{row.status}</span>
                <span className="min-w-0 flex-1 truncate">
                  {row.left ? `${row.left.name} ${row.left.address}` : "—"}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {row.right ? `${row.right.name} ${row.right.address}` : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
