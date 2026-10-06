import { createGameState } from "@t3tools/client-runtime/state/game";
import { connectionAtomRuntime } from "../connection/runtime";
export const gameState = createGameState(connectionAtomRuntime);
