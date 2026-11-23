import { msg, useMessages } from "gt-react-native";
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
import { View } from "react-native";
import { AppText, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useEnvironments } from "../../state/environments";
import { projectKnowledge } from "../../state/projectKnowledge";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "./components/SettingsSection";

export function ProjectKnowledgeSection({ project }: { readonly project: EnvironmentProject }) {
  const m = useMessages();

  const { environments } = useEnvironments();
  const environment = environments.find((value) => value.environmentId === project.environmentId);
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
    <SettingsSection title={m(msg("Project knowledge"))} footer={project.workspaceRoot}>
      <View className="gap-3 p-4">
        <AppText>
          {m(msg("Search docs and saved notes. Notes change only when explicitly saved."))}
        </AppText>
        {error ? <AppText accessibilityRole="alert">{error}</AppText> : null}
        {!open ? (
          <Button
            label={m(msg("Open knowledge"))}
            onPress={() => {
              setOpen(true);
              if (canReadNotes) void loadNotes();
            }}
          />
        ) : (
          <>
            <AppTextInput
              accessibilityLabel={m(msg("Search project knowledge"))}
              placeholder={m(msg("Search docs and notes"))}
              value={query}
              maxLength={256}
              onChangeText={setQuery}
              editable={!pending && canSearch}
              onSubmitEditing={() => {
                if (!pending && canSearch && query.trim()) void runSearch();
              }}
            />
            <Button
              label={m(msg("Search"))}
              disabled={pending || !canSearch || !query.trim()}
              onPress={() => void runSearch()}
            />
            {results ? (
              <View className="gap-3">
                {results.indexingIncomplete ? (
                  <AppText>
                    {m(msg("Some passages remain to be indexed. Search again to continue."))}
                  </AppText>
                ) : null}
                {results.retrieval === "literal" ? (
                  <AppText>
                    {m(
                      msg(
                        "Semantic search unavailable. Showing text matches. Set up Ollama on this environment to search by meaning.",
                      ),
                    )}
                  </AppText>
                ) : results.retrieval === "hybrid" ? (
                  <AppText>{m(msg("Searching by meaning and text."))}</AppText>
                ) : null}
                {!results.docsAvailable ? (
                  <AppText>
                    {m(msg("No docs folder in this checkout. Saved notes are still available."))}
                  </AppText>
                ) : null}
                {results.matches.length === 0 ? (
                  <AppText>{m(msg("No matches."))}</AppText>
                ) : (
                  results.matches.map((hit) => (
                    <View key={`${hit.source}:${hit.path}:${hit.startLine}`}>
                      <Button
                        tone="text"
                        label={`${hit.path}:${hit.startLine}`}
                        disabled={pending}
                        onPress={() => void inspect(hit)}
                      />
                      <AppText selectable>{hit.content}</AppText>
                    </View>
                  ))
                )}
                {results.truncated ? (
                  <AppText>{m(msg("More matches available. Narrow your search."))}</AppText>
                ) : null}
              </View>
            ) : null}
            {source ? (
              <View className="gap-2">
                <AppText>
                  {source.path}:{source.startLine}–{source.endLine}
                </AppText>
                <AppText selectable>
                  {source.content
                    .split("\n")
                    .map((line, index) => `${source.startLine + index}  ${line}`)
                    .join("\n")}
                </AppText>
                {source.truncated ? (
                  <AppText>{m(msg("Source passage is shortened."))}</AppText>
                ) : null}
                {source.nextStartLine !== undefined ? (
                  <Button
                    label={m(msg("Read next passage"))}
                    disabled={pending}
                    onPress={() => void inspect(source, source.nextStartLine)}
                  />
                ) : null}
              </View>
            ) : null}
            <AppText>{m(msg("Saved project notes"))}</AppText>
            <AppTextInput
              accessibilityLabel={m(msg("Saved project notes"))}
              value={draft}
              onChangeText={setDraft}
              maxLength={PROJECT_NOTES_MAX_LENGTH}
              multiline
              editable={!pending && notes !== null && canSave}
            />
            <AppText>{draft.length} / 16,000 characters. Save an empty note to clear it.</AppText>
            <Button
              label={m(msg("Save notes"))}
              disabled={pending || !notes || !canSave || draft === notes.content}
              onPress={() => void save()}
            />
            <Button
              label={m(msg("Reload notes (discard draft)"))}
              disabled={pending || !canReadNotes}
              onPress={() => void loadNotes()}
            />
          </>
        )}
      </View>
    </SettingsSection>
  );
}
