import { KeyRound } from "lucide-react";

import { Button } from "~/components/ui/button";

interface Props {
  origin: string;
  onOpenInBrowser: (() => void) | undefined;
}

const hostOf = (origin: string) => (URL.canParse(origin) ? new URL(origin).host : origin);

/**
 * Shown while a desktop guest waits on a security key that Electron gives no prompt for.
 * It clears itself when the page's request settles; the page owns cancelling it.
 */
export function SecurityKeyNotice({ origin, onOpenInBrowser }: Props) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-3">
      <div
        role="status"
        className="pointer-events-auto flex max-w-md items-start gap-3 rounded-lg border border-border/70 bg-popover/95 p-3 text-sm shadow-md/10 backdrop-blur"
      >
        <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">Touch your security key</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {hostOf(origin)} is waiting for your security key. Keys that need a PIN only work in
            your system browser.
          </p>
        </div>
        {onOpenInBrowser ? (
          <Button type="button" variant="outline" size="xs" onClick={onOpenInBrowser}>
            Open in system browser
          </Button>
        ) : null}
      </div>
    </div>
  );
}
