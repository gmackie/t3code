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

const BAUD_RATES = [
  1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600,
] as const;
type Baud = (typeof BAUD_RATES)[number];
const LINE_ENDINGS = { none: "", lf: "\n", cr: "\r", crlf: "\r\n" } as const;
type LineEnding = keyof typeof LINE_ENDINGS;

const encodeText = (text: string) => {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/** One open serial session: its output and a send box. */
function SerialSessionView({
  threadRef,
  projectId,
  sessionId,
  label,
  onClosed,
}: {
  threadRef: ScopedThreadRef;
  projectId: string;
  sessionId: string;
  label: string;
  onClosed: () => void;
}) {
  const output = useEnvironmentQuery(
    reverseEnvironment.serialOutput({
      environmentId: threadRef.environmentId,
      input: { projectId, sessionId },
    }),
  );
  const write = useAtomCommand(reverseEnvironment.writeSerial, { reportFailure: false });
  const close = useAtomCommand(reverseEnvironment.closeSerial, { reportFailure: false });
  const [line, setLine] = useState(""),
    [ending, setEnding] = useState<LineEnding>("lf");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const log = useRef<HTMLPreElement | null>(null);
  const text = output.data?.text ?? "";
  // Follow new output while the reader is already at the bottom.
  useEffect(() => {
    const element = log.current;
    if (text && element && element.scrollHeight - element.scrollTop - element.clientHeight < 40)
      element.scrollTop = element.scrollHeight;
  }, [text]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  const send = () =>
    run(async () => {
      const response = await write({
        environmentId: threadRef.environmentId,
        input: { projectId, sessionId, data: encodeText(line + LINE_ENDINGS[ending]) },
      });
      if (response._tag === "Failure") throw squashAtomCommandFailure(response);
      setLine("");
    });

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono">{label}</span>
        <Button
          size="xs"
          variant="ghost-destructive"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const response = await close({
                environmentId: threadRef.environmentId,
                input: { projectId, sessionId },
              });
              if (response._tag === "Failure") throw squashAtomCommandFailure(response);
              onClosed();
            })
          }
        >
          Close
        </Button>
      </div>
      <pre
        ref={log}
        aria-label={`Serial output of ${label}`}
        className="max-h-64 min-h-24 overflow-auto whitespace-pre-wrap break-all border border-border p-2 font-mono"
      >
        {text || (output.error ? "" : "Waiting for output…")}
      </pre>
      {output.error && (
        <p role="alert" className="text-destructive">
          {String(output.error)}
        </p>
      )}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <Input
          aria-label="Text to send"
          placeholder="Text to send"
          value={line}
          onChange={(event) => setLine(event.target.value)}
        />
        <Select
          value={ending}
          onValueChange={(value) => {
            if (value !== null) setEnding(value);
          }}
        >
          <SelectTrigger size="xs" className="w-24" aria-label="Line ending">
            <SelectValue>{ending === "none" ? "No ending" : ending.toUpperCase()}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {(Object.keys(LINE_ENDINGS) as LineEnding[]).map((key) => (
              <SelectItem key={key} value={key}>
                {key === "none" ? "No ending" : key.toUpperCase()}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={busy || (!line && ending === "none")}
        >
          Send
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** Serial ports on the environment's host, and consoles open on them. */
export function SerialPanel({
  threadRef,
  projectId,
}: {
  threadRef: ScopedThreadRef;
  projectId: string;
}) {
  const ports = useEnvironmentQuery(
    reverseEnvironment.serialPorts({
      environmentId: threadRef.environmentId,
      input: { projectId },
    }),
  );
  const open = useAtomCommand(reverseEnvironment.openSerial, { reportFailure: false });
  const [port, setPort] = useState<string | null>(null),
    [baud, setBaud] = useState<Baud>(115200);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const available = ports.data?.ports ?? [];
  const sessions = ports.data?.sessions ?? [];

  return (
    <section aria-label="Serial" className="space-y-2 border-t border-border p-3">
      <h3 className="text-xs font-medium">Serial</h3>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={port} onValueChange={setPort}>
          <SelectTrigger size="xs" className="w-56" aria-label="Serial port">
            <SelectValue>
              {port ?? (available.length ? "Choose a port" : "No serial ports found")}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {available.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Select
          value={baud}
          onValueChange={(value) => {
            if (value !== null) setBaud(value);
          }}
        >
          <SelectTrigger size="xs" className="w-24" aria-label="Baud rate">
            <SelectValue>{baud}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {BAUD_RATES.map((rate) => (
              <SelectItem key={rate} value={rate}>
                {rate}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Button
          size="xs"
          variant="outline"
          disabled={busy || !port}
          onClick={async () => {
            if (!port) return;
            setBusy(true);
            setError(null);
            try {
              const response = await open({
                environmentId: threadRef.environmentId,
                input: { projectId, port, baud },
              });
              if (response._tag === "Failure") throw squashAtomCommandFailure(response);
              ports.refresh();
            } catch (cause) {
              setError(String(cause));
            } finally {
              setBusy(false);
            }
          }}
        >
          Open
        </Button>
        <Button size="xs" variant="ghost" onClick={() => ports.refresh()}>
          Refresh ports
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {sessions.map((session) => (
        <SerialSessionView
          key={session.id}
          threadRef={threadRef}
          projectId={projectId}
          sessionId={session.id}
          label={`${session.port} · ${session.baud} baud`}
          onClosed={() => ports.refresh()}
        />
      ))}
    </section>
  );
}
