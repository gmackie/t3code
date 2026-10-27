import type { SystemsDiagnostic } from "@t3tools/contracts";
import { Badge } from "~/components/ui/badge";

export function Diagnostics({
  diagnostics,
  empty,
}: {
  readonly diagnostics: ReadonlyArray<SystemsDiagnostic>;
  readonly empty: string;
}) {
  if (!diagnostics.length) return <p className="text-muted-foreground">{empty}</p>;
  return (
    <ul className="mt-1 space-y-1">
      {diagnostics.map((diagnostic) => (
        <li
          key={`${diagnostic.code}:${diagnostic.file ?? ""}${diagnostic.pointer ?? ""}:${diagnostic.elementId ?? ""}:${diagnostic.message}`}
        >
          <Badge variant={diagnostic.severity === "error" ? "error" : "warning"}>
            {diagnostic.code}
          </Badge>{" "}
          {diagnostic.elementId && <span className="font-mono">{diagnostic.elementId} </span>}
          {diagnostic.message}
          {diagnostic.file && (
            <span className="text-muted-foreground">
              {" "}
              · {diagnostic.file}
              {diagnostic.pointer ?? ""}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
