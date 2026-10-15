import { useEffect, useRef, useState } from "react";
import type { ReverseFindingRecord, ScopedThreadRef } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { reverseEnvironment } from "~/state/reverse";
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

const KINDS = [
  { value: "memory-corruption", label: "Memory corruption" },
  { value: "attack-surface", label: "Attack surface" },
  { value: "boot-chain", label: "Boot chain" },
  { value: "crypto", label: "Crypto" },
  { value: "protocol", label: "Protocol" },
  { value: "gadget", label: "Gadget" },
  { value: "other", label: "Other" },
] as const;
type Kind = (typeof KINDS)[number]["value"];
type Status = ReverseFindingRecord["status"];

// What a person can move a finding to from each status. Every closed state can be reopened.
const NEXT: Record<Status, ReadonlyArray<{ status: Status; label: string }>> = {
  candidate: [
    { status: "probable", label: "Probable" },
    { status: "confirmed", label: "Confirm" },
    { status: "rejected", label: "Reject" },
  ],
  probable: [
    { status: "confirmed", label: "Confirm" },
    { status: "rejected", label: "Reject" },
  ],
  confirmed: [
    { status: "superseded", label: "Supersede" },
    { status: "candidate", label: "Reopen" },
  ],
  rejected: [{ status: "candidate", label: "Reopen" }],
  superseded: [{ status: "candidate", label: "Reopen" }],
};

/** A draft handed over from elsewhere in the workspace, such as the selected function. */
export type FindingSeed = {
  readonly nonce: number;
  readonly title: string;
  readonly address: string;
};

export function FindingsPanel({
  threadRef,
  projectId,
  investigationId,
  artifactSha256,
  findings,
  seed,
  onChanged,
}: {
  threadRef: ScopedThreadRef;
  projectId: string;
  investigationId: string;
  artifactSha256: string;
  findings: ReadonlyArray<ReverseFindingRecord>;
  seed: FindingSeed | null;
  onChanged: () => void;
}) {
  const create = useAtomCommand(reverseEnvironment.createFinding, { reportFailure: false });
  const update = useAtomCommand(reverseEnvironment.updateFinding, { reportFailure: false });
  const [title, setTitle] = useState(""),
    [kind, setKind] = useState<Kind>("memory-corruption"),
    [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // Each new draft from elsewhere replaces the form once, without an extra render pass.
  const [appliedSeed, setAppliedSeed] = useState(0);
  if (seed && seed.nonce !== appliedSeed) {
    setAppliedSeed(seed.nonce);
    setTitle(seed.title);
    setAddress(seed.address);
  }

  const addressValid = address === "" || /^0x[0-9a-f]+$/i.test(address.trim());
  async function submit(run: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await run();
      if (alive.current) onChanged();
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const record = () =>
    submit(async () => {
      const response = await create({
        environmentId: threadRef.environmentId,
        input: {
          projectId,
          investigationId,
          title: title.trim(),
          kind,
          evidence: address.trim()
            ? [
                {
                  kind: "code",
                  // Ghidra's default address space; the architecture is not tracked per finding yet.
                  location: {
                    artifactSha256,
                    addressSpace: "ram",
                    address: address.trim(),
                    architecture: "unspecified",
                  },
                },
              ]
            : [],
        },
      });
      if (response._tag === "Failure") throw squashAtomCommandFailure(response);
      if (alive.current) {
        setTitle("");
        setAddress("");
      }
    });
  const move = (findingId: string, status: Status) =>
    submit(async () => {
      const response = await update({
        environmentId: threadRef.environmentId,
        input: { projectId, findingId, status },
      });
      if (response._tag === "Failure") throw squashAtomCommandFailure(response);
    });

  return (
    <section aria-label="Findings" className="space-y-2 border-b border-border p-3">
      <h3 className="text-xs font-medium">Findings</h3>
      {findings.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No findings yet. Record what you or an agent suspect; a person confirms them.
        </p>
      )}
      <ul className="space-y-2">
        {findings.map((finding) => (
          <li key={finding.id} className="text-xs">
            <p>
              <span className="font-medium">{finding.title}</span>{" "}
              <span className="text-muted-foreground">
                · {finding.kind} · {finding.status} · by {finding.authorKind}
              </span>
            </p>
            {finding.evidence.map((ref) =>
              ref.kind === "code" ? (
                <p key={ref.location.address} className="font-mono text-muted-foreground">
                  {ref.location.addressSpace}:{ref.location.address}
                </p>
              ) : null,
            )}
            <div className="mt-1 flex flex-wrap gap-1">
              {NEXT[finding.status].map((next) => (
                <Button
                  key={next.status}
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void move(finding.id, next.status)}
                >
                  {next.label}
                </Button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void record();
        }}
      >
        <Input
          aria-label="Finding title"
          placeholder="What you suspect"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <div className="flex gap-2">
          <Select
            value={kind}
            disabled={busy}
            onValueChange={(value) => {
              if (value !== null) setKind(value);
            }}
          >
            <SelectTrigger size="xs" className="w-40" aria-label="Finding kind">
              <SelectValue>{KINDS.find((option) => option.value === kind)?.label}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {KINDS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <Input
            aria-label="Code address evidence"
            placeholder="0x… (optional)"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
        </div>
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={busy || !title.trim() || !addressValid}
        >
          Record finding
        </Button>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
