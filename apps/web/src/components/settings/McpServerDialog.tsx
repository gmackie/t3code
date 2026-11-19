import { msg, useMessages } from "gt-react";
import type { McpServerConfig, McpServerTransport } from "@t3tools/contracts";
import { LockIcon, LockOpenIcon, PlusIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  EMPTY_MCP_SERVER_DRAFT,
  mcpServerDraftFrom,
  type McpServerDraft,
  mcpServerFromDraft,
  type McpVariableDraft,
  nextMcpVariableDraftId,
  parseMcpServerJson,
} from "./toolsSettings.logic";

/**
 * Add or edit one MCP server. Pasting the JSON snippet from a vendor's docs
 * fills the form; secrets in env vars and headers default to sensitive, so
 * they are stored on the environment's secret store and never sent back.
 */
export function McpServerDialog({
  open,
  onOpenChange,
  scopeLabel,
  initial,
  takenNames,
  onSave,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Where the server is saved, e.g. "This Mac" or a project name. */
  readonly scopeLabel: string;
  readonly initial: { readonly name: string; readonly config: McpServerConfig } | null;
  readonly takenNames: ReadonlySet<string>;
  readonly onSave: (server: { name: string; transport: McpServerTransport }) => Promise<{
    saved: boolean;
    partial: boolean;
  }>;
}) {
  const m = useMessages();

  const id = useId();
  const [draft, setDraft] = useState<McpServerDraft>(() =>
    initial ? mcpServerDraftFrom(initial.name, initial.config) : EMPTY_MCP_SERVER_DRAFT,
  );
  const [paste, setPaste] = useState("");
  const [pasteError, setPasteError] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const [retryOnly, setRetryOnly] = useState(false);
  const result = mcpServerFromDraft(draft, pending ? new Set() : takenNames, initial?.name ?? null);
  const error = attempted && !result.ok ? result : null;

  const update = (patch: Partial<McpServerDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const variablesKey = draft.type === "stdio" ? "env" : "headers";
  const variables = draft[variablesKey];
  const setVariables = (next: ReadonlyArray<McpVariableDraft>) => update({ [variablesKey]: next });

  const applyPaste = (text: string) => {
    setPaste(text);
    if (text.trim().length === 0) {
      setPasteError(false);
      return;
    }
    const parsed = parseMcpServerJson(text);
    setPasteError(parsed === null);
    if (parsed !== null) {
      setDraft((current) => ({ ...parsed, name: parsed.name || current.name }));
    }
  };

  const save = async () => {
    if (pending) return;
    setAttempted(true);
    if (!result.ok) return;
    setPending(true);
    try {
      const saved = await onSave({ name: result.name, transport: result.transport });
      setRetryOnly(!saved.saved && saved.partial);
    } catch (error) {
      toastManager.add({
        type: "warning",
        title: m(msg("Tools not saved")),
        description: error instanceof Error ? error.message : m(msg("Could not update tools.")),
      });
    }
    setPending(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {initial ? m(msg("Edit {value0}", { value0: initial.name })) : m(msg("Add MCP server"))}
          </DialogTitle>
          <DialogDescription>
            {m(msg("Saved for "))}
            {scopeLabel}
            {m(msg(". Agents get it in their next session."))}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel inert={pending || retryOnly}>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            {initial === null ? (
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-paste`}>{m(msg("Paste config (optional)"))}</Label>
                <Textarea
                  id={`${id}-paste`}
                  size="sm"
                  rows={3}
                  // oxlint-disable-next-line t3code/no-untranslated-copy -- JSON configuration example stays literal.
                  placeholder={'{ "linear": { "url": "https://mcp.linear.app/mcp" } }'}
                  value={paste}
                  onChange={(event) => applyPaste(event.target.value)}
                  spellCheck={false}
                />
                {pasteError ? (
                  <p className="text-xs text-destructive-foreground">
                    {m(
                      msg("Couldn't find a server in that JSON. Fill in the fields below instead."),
                    )}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-name`}>{m(msg("Name"))}</Label>
              <Input
                id={`${id}-name`}
                font="mono"
                placeholder="linear"
                value={draft.name}
                onChange={(event) => update({ name: event.target.value.toLowerCase() })}
                aria-invalid={error?.field === "name" || undefined}
                autoFocus={initial !== null}
                spellCheck={false}
              />
              {error?.field === "name" ? (
                <p className="text-xs text-destructive-foreground">{error.message}</p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label>{m(msg("Type"))}</Label>
              <ToggleGroup
                aria-label={m(msg("Server type"))}
                variant="segmented"
                value={[draft.type]}
                onValueChange={(next) => {
                  const value = next[0];
                  if (value === "stdio" || value === "http") update({ type: value });
                }}
              >
                <Toggle value="stdio">{m(msg("Command"))}</Toggle>
                <Toggle value="http">URL</Toggle>
              </ToggleGroup>
            </div>
            {draft.type === "stdio" ? (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor={`${id}-command`}>{m(msg("Command"))}</Label>
                  <Input
                    id={`${id}-command`}
                    font="mono"
                    placeholder="npx"
                    value={draft.command}
                    onChange={(event) => update({ command: event.target.value })}
                    aria-invalid={error?.field === "command" || undefined}
                    spellCheck={false}
                  />
                  {error?.field === "command" ? (
                    <p className="text-xs text-destructive-foreground">{error.message}</p>
                  ) : null}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`${id}-args`}>{m(msg("Arguments"))}</Label>
                  <Input
                    id={`${id}-args`}
                    font="mono"
                    placeholder="-y @playwright/mcp@latest"
                    value={draft.args}
                    onChange={(event) => update({ args: event.target.value })}
                    spellCheck={false}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor={`${id}-url`}>URL</Label>
                  <Input
                    id={`${id}-url`}
                    font="mono"
                    placeholder="https://mcp.example.com/mcp"
                    value={draft.url}
                    onChange={(event) => update({ url: event.target.value })}
                    aria-invalid={error?.field === "url" || undefined}
                    spellCheck={false}
                  />
                  {error?.field === "url" ? (
                    <p className="text-xs text-destructive-foreground">{error.message}</p>
                  ) : null}
                </div>
                <div className="flex items-start justify-between gap-3">
                  <div className="grid gap-0.5">
                    <Label htmlFor={`${id}-oauth`}>{m(msg("Sign in with OAuth"))}</Label>
                    <p className="text-xs text-muted-foreground">
                      {m(
                        msg(
                          "T3 signs in once for this environment and keeps the token; agents never see it.",
                        ),
                      )}
                    </p>
                  </div>
                  <Switch
                    id={`${id}-oauth`}
                    checked={draft.oauth}
                    onCheckedChange={(oauth) => update({ oauth })}
                  />
                </div>
                {draft.oauth ? (
                  <>
                    <div className="grid gap-1.5">
                      <Label htmlFor={`${id}-oauth-scopes`}>{m(msg("Scopes"))}</Label>
                      <Input
                        id={`${id}-oauth-scopes`}
                        font="mono"
                        placeholder={m(msg("Leave empty for the server's defaults"))}
                        value={draft.oauthScopes}
                        onChange={(event) => update({ oauthScopes: event.target.value })}
                        spellCheck={false}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor={`${id}-oauth-client`}>{m(msg("Client ID"))}</Label>
                      <Input
                        id={`${id}-oauth-client`}
                        font="mono"
                        placeholder={m(msg("Only if the server can't register clients itself"))}
                        value={draft.oauthClientId}
                        onChange={(event) => update({ oauthClientId: event.target.value })}
                        spellCheck={false}
                      />
                    </div>
                  </>
                ) : null}
              </>
            )}
            <VariablesEditor
              label={draft.type === "stdio" ? m(msg("Environment variables")) : m(msg("Headers"))}
              namePlaceholder={draft.type === "stdio" ? m(msg("API_KEY")) : m(msg("Authorization"))}
              variables={variables}
              onChange={setVariables}
            />
            {error?.field === "variables" ? (
              <p role="alert" className="text-xs text-destructive-foreground">
                {error.message}
              </p>
            ) : null}
          </form>
        </DialogPanel>
        {retryOnly ? (
          <p role="status" className="px-6 text-sm text-muted-foreground">
            {m(
              msg(
                "Some environments were updated. Retry to finish saving, or close and reopen the editor to make further changes.",
              ),
            )}
          </p>
        ) : null}
        <DialogFooter variant="bare">
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            {m(msg("Cancel"))}
          </Button>
          <Button disabled={pending} onClick={() => void save()}>
            {pending
              ? m(msg("Saving…"))
              : retryOnly
                ? m(msg("Retry save"))
                : initial
                  ? m(msg("Save"))
                  : m(msg("Add server"))}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function VariablesEditor({
  label,
  namePlaceholder,
  variables,
  onChange,
}: {
  readonly label: string;
  readonly namePlaceholder: string;
  readonly variables: ReadonlyArray<McpVariableDraft>;
  readonly onChange: (next: ReadonlyArray<McpVariableDraft>) => void;
}) {
  const m = useMessages();

  const update = (id: string, patch: Partial<McpVariableDraft>) =>
    onChange(
      variables.map((variable) =>
        variable.id === id
          ? {
              ...variable,
              ...patch,
              // Typing a value replaces a stored secret; clearing it again
              // while still secret brings the stored one back.
              ...(patch.value !== undefined
                ? {
                    stored:
                      patch.value.length === 0 &&
                      (patch.sensitive ?? variable.sensitive) &&
                      variable.storedName !== undefined,
                  }
                : {}),
            }
          : variable,
      ),
    );
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={() =>
            onChange([
              ...variables,
              { id: nextMcpVariableDraftId(), name: "", value: "", sensitive: true, stored: false },
            ])
          }
        >
          <PlusIcon className="size-3" aria-hidden />
          {m(msg("Add"))}
        </Button>
      </div>
      {variables.length === 0 ? null : (
        <div className="grid gap-1.5">
          {variables.map((variable, index) => (
            <div key={variable.id} className="flex min-w-0 items-center gap-1.5">
              <Input
                size="sm"
                font="mono"
                className="w-36 shrink-0"
                placeholder={namePlaceholder}
                value={variable.name}
                onChange={(event) => update(variable.id, { name: event.target.value })}
                aria-label={`${label} name ${index + 1}`}
                spellCheck={false}
              />
              <Input
                size="sm"
                font="mono"
                className="min-w-0 flex-1"
                type={variable.sensitive ? "password" : undefined}
                autoComplete="off"
                placeholder={variable.stored ? m(msg("Stored secret, type to replace")) : "value"}
                value={variable.value}
                onChange={(event) => update(variable.id, { value: event.target.value })}
                aria-label={`${label} value ${index + 1}`}
                spellCheck={false}
              />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      size="icon-micro"
                      variant="ghost-muted"
                      aria-pressed={variable.sensitive}
                      aria-label={m(
                        msg("Mark {value0} as secret", {
                          value0: variable.name || `${label} ${index + 1}`,
                        }),
                      )}
                      onClick={() =>
                        update(variable.id, {
                          sensitive: !variable.sensitive,
                          // Plain text needs a real value, so a stored secret is
                          // set aside while the variable is plain and comes back
                          // when it is marked secret again with nothing typed.
                          stored:
                            !variable.sensitive &&
                            variable.storedName !== undefined &&
                            variable.value.length === 0,
                        })
                      }
                    />
                  }
                >
                  {variable.sensitive ? (
                    <LockIcon className="size-3" />
                  ) : (
                    <LockOpenIcon className="size-3" />
                  )}
                </TooltipTrigger>
                <TooltipPopup side="top">
                  {variable.sensitive ? m(msg("Secret, kept on the server")) : m(msg("Plain text"))}
                </TooltipPopup>
              </Tooltip>
              <Button
                type="button"
                size="icon-micro"
                variant="ghost-destructive"
                aria-label={m(
                  msg("Remove {value0}", { value0: variable.name || `${label} ${index + 1}` }),
                )}
                onClick={() => onChange(variables.filter((entry) => entry.id !== variable.id))}
              >
                <XIcon className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
