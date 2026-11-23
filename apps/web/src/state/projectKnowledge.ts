import { createProjectKnowledgeCommands } from "@t3tools/client-runtime/state/projectKnowledge";
import { connectionAtomRuntime } from "../connection/runtime";
export const projectKnowledge = createProjectKnowledgeCommands(connectionAtomRuntime);
