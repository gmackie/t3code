import type { EnvironmentId, ScopedProjectRef } from "@t3tools/contracts";
import { useState } from "react";
import { useCompleteOnboarding } from "../../onboarding/firstRun";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { WizardPopup, WizardHeader, WizardFooter } from "../ui/wizard";

export function WelcomeWizard({
  localAvailable,
  onDone,
}: {
  readonly localAvailable: boolean;
  readonly resumeEnvironmentId?: EnvironmentId | undefined;
  readonly onDone: (projectRef?: ScopedProjectRef) => void | Promise<void>;
}) {
  const completeOnboarding = useCompleteOnboarding();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function finish() {
    setBusy(true);
    setError(null);
    try {
      await completeOnboarding();
      await onDone();
    } catch {
      setError("Could not finish setup. Try again.");
      setBusy(false);
    }
  }
  return (
    <Dialog open>
      <WizardPopup>
        <WizardHeader
          title="Welcome to T3 Code Locked"
          description="Work with OpenCode and projects on this computer."
        />
        <div className="px-6 py-4 space-y-3">
          <p>
            Install your approved OpenCode version and configure Workers AI through Cloudflare AI
            Gateway before starting a thread. You can select its executable in Settings → Providers.
          </p>
          <p>
            Add a local project to begin. GitLab, browser and device automation, MCP/plugins, and
            scheduled tasks are available.
          </p>
          {!localAvailable ? <p>Waiting for the local server.</p> : null}
          {error ? <p role="alert">{error}</p> : null}
        </div>
        <WizardFooter>
          <Button disabled={!localAvailable || busy} onClick={() => void finish()}>
            {busy ? "Starting…" : "Get started"}
          </Button>
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}
