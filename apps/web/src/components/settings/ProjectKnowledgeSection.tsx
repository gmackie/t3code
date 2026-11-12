import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  PROJECT_NOTES_MAX_LENGTH,
  type ProjectKnowledgeNotes,
  type ProjectKnowledgePassage,
  type ProjectKnowledgeSearchResult,
} from "@t3tools/contracts";
import { useState } from "react";
import { projectKnowledgeFailure } from "@t3tools/client-runtime/state/projectKnowledge";
import { useEnvironment } from "../../state/environments";
import { projectKnowledge } from "../../state/projectKnowledge";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { SettingsSection } from "./settingsLayout";

export function ProjectKnowledgeSection({
  project,
}: {
  readonly project: Pick<EnvironmentProject, "id" | "environmentId" | "workspaceRoot">;
}) {
  const environment = useEnvironment(project.environmentId);
  const canSearch = useAtomValue(projectKnowledge.search.permissionAtom(project.environmentId));
  const canReadNotes = useAtomValue(
    projectKnowledge.getNotes.permissionAtom(project.environmentId),
  );
  const canSave = useAtomValue(projectKnowledge.saveNotes.permissionAtom(project.environmentId));
  const search = useAtomCommand(projectKnowledge.search);
  const read = useAtomCommand(projectKnowledge.read);
  const getNotes = useAtomCommand(projectKnowledge.getNotes);
  const saveNotes = useAtomCommand(projectKnowledge.saveNotes);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProjectKnowledgeSearchResult | null>(null);
  const [source, setSource] = useState<ProjectKnowledgePassage | null>(null);
  const [notes, setNotes] = useState<ProjectKnowledgeNotes | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = { environmentId: project.environmentId, input: { projectId: project.id } };
  if (environment?.serverConfig?.environment.capabilities.projectKnowledge !== true) return null;
  const loadNotes = async () => {
    setPending(true);
    setError(null);
    const result = await getNotes(target);
    if (result._tag === "Success") {
      setNotes(result.value);
      setDraft(result.value.content);
    } else setError(projectKnowledgeFailure(result));
    setPending(false);
  };
  const runSearch = async () => {
    setPending(true);
    setError(null);
    const result = await search({
      ...target,
      input: { projectId: project.id, query, limit: 20 },
    });
    if (result._tag === "Success") {
      setResults(result.value);
      setSource(null);
    } else setError(projectKnowledgeFailure(result));
    setPending(false);
  };
  const inspect = async (hit: ProjectKnowledgePassage, startLine?: number) => {
    setPending(true);
    setError(null);
    const result = await read({
      ...target,
      input: {
        projectId: project.id,
        source: hit.source,
        path: hit.path,
        startLine: startLine ?? Math.max(1, hit.startLine - 10),
        lineCount: 80,
      },
    });
    if (result._tag === "Success") setSource(result.value);
    else setError(projectKnowledgeFailure(result));
    setPending(false);
  };
  const save = async () => {
    if (!notes) return;
    setPending(true);
    setError(null);
    const result = await saveNotes({
      ...target,
      input: { projectId: project.id, content: draft, expectedRevision: notes.revision },
    });
    if (result._tag === "Success") setNotes(result.value);
    else setError(projectKnowledgeFailure(result));
    setPending(false);
  };
  return (
    <SettingsSection title="Project knowledge">
      <p className="break-all text-xs text-muted-foreground">
        {environment?.label}: {project.workspaceRoot}
      </p>
      <p className="text-sm text-muted-foreground">
        Search docs and saved notes. Notes change only when explicitly saved.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!open ? (
        <div>
          <Button
            variant="outline"
            onClick={() => {
              setOpen(true);
              if (canReadNotes) void loadNotes();
            }}
          >
            Open knowledge
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch();
            }}
          >
            <Input
              aria-label="Search project knowledge"
              placeholder="Search docs and notes"
              value={query}
              maxLength={256}
              onChange={(event) => setQuery(event.target.value)}
              disabled={pending || !canSearch}
            />
            <Button type="submit" disabled={pending || !canSearch || !query.trim()}>
              Search
            </Button>
          </form>
          {results ? (
            <div className="flex flex-col gap-2" aria-live="polite">
              {results.indexingIncomplete ? (
                <p className="text-sm text-muted-foreground">
                  Some passages remain to be indexed. Search again to continue.
                </p>
              ) : null}
              {results.retrieval === "literal" ? (
                <p className="text-sm text-muted-foreground">
                  Semantic search unavailable. Showing text matches. Set up Ollama on this
                  environment to search by meaning.
                </p>
              ) : results.retrieval === "hybrid" ? (
                <p className="text-sm text-muted-foreground">Searching by meaning and text.</p>
              ) : null}
              {!results.docsAvailable ? (
                <p className="text-sm text-muted-foreground">
                  No docs folder in this checkout. Saved notes are still available.
                </p>
              ) : null}
              {results.matches.length === 0 ? (
                <p className="text-sm text-muted-foreground">No matches.</p>
              ) : (
                results.matches.map((hit) => (
                  <div key={`${hit.source}:${hit.path}:${hit.startLine}`}>
                    <Button variant="link" disabled={pending} onClick={() => void inspect(hit)}>
                      {hit.path}:{hit.startLine}
                    </Button>
                    <pre className="whitespace-pre-wrap break-words text-xs">{hit.content}</pre>
                  </div>
                ))
              )}
              {results.truncated ? (
                <p className="text-sm text-muted-foreground">
                  More matches available. Narrow your search.
                </p>
              ) : null}
            </div>
          ) : null}
          {source ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                {source.path}:{source.startLine}–{source.endLine}
              </p>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">
                {source.content
                  .split("\n")
                  .map((line, index) => `${source.startLine + index}  ${line}`)
                  .join("\n")}
              </pre>
              {source.truncated ? <p>Source passage is shortened.</p> : null}
              {source.nextStartLine !== undefined ? (
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => void inspect(source, source.nextStartLine)}
                >
                  Read next passage
                </Button>
              ) : null}
            </div>
          ) : null}
          <label className="flex flex-col gap-2 text-sm">
            Saved project notes
            <Textarea
              aria-label="Saved project notes"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={PROJECT_NOTES_MAX_LENGTH}
              rows={7}
              disabled={pending || !notes || !canSave}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            {draft.length.toLocaleString()} / 16,000 characters. Save an empty note to clear it.
          </p>
          <div className="flex gap-2">
            <Button
              disabled={pending || !notes || !canSave || draft === notes.content}
              onClick={() => void save()}
            >
              Save notes
            </Button>
            <Button
              variant="outline"
              disabled={pending || !canReadNotes}
              onClick={() => void loadNotes()}
            >
              Reload notes (discard draft)
            </Button>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
