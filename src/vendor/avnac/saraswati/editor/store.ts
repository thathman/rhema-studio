import { applyCommand } from "../commands/reducer";
import type { SaraswatiCommand } from "../commands/types";
import type { SaraswatiScene } from "../scene";

const MAX_UNDO_DEPTH = 80;

export type SaraswatiEditorState = {
  scene: SaraswatiScene;
  canUndo: boolean;
  canRedo: boolean;
};

type Listener = (state: SaraswatiEditorState) => void;

export type SaraswatiEditorStore = {
  getState: () => SaraswatiEditorState;
  subscribe: (listener: Listener) => () => void;
  /**
   * Apply a command. Pushes the current scene onto the undo stack and clears
   * the redo stack — same input always produces the same result.
   */
  dispatch: (command: SaraswatiCommand) => void;
  beginBatch: () => void;
  endBatch: () => void;
  /** Revert the last dispatched command batch. No-op when canUndo is false. */
  undo: () => void;
  /** Re-apply the last undone state. No-op when canRedo is false. */
  redo: () => void;
};

export function createSaraswatiEditorStore(
  initialScene: SaraswatiScene,
): SaraswatiEditorStore {
  let undoStack: SaraswatiScene[] = [];
  let redoStack: SaraswatiScene[] = [];
  let batchDepth = 0;
  let batchBaseScene: SaraswatiScene | null = null;

  let state: SaraswatiEditorState = {
    scene: initialScene,
    canUndo: false,
    canRedo: false,
  };

  const listeners = new Set<Listener>();

  function emit() {
    for (const listener of listeners) {
      listener(state);
    }
  }

  function buildState(scene: SaraswatiScene): SaraswatiEditorState {
    return {
      scene,
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
    };
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    beginBatch() {
      batchDepth += 1;
      if (batchDepth === 1) {
        batchBaseScene = state.scene;
      }
    },
    dispatch(command) {
      const nextScene = applyCommand(state.scene, command);
      if (nextScene === state.scene) return;
      if (batchDepth === 0) {
        undoStack = [...undoStack.slice(-(MAX_UNDO_DEPTH - 1)), state.scene];
        redoStack = [];
      }
      state = buildState(nextScene);
      emit();
    },
    endBatch() {
      if (batchDepth === 0) return;
      batchDepth -= 1;
      if (batchDepth > 0) return;

      if (batchBaseScene && batchBaseScene !== state.scene) {
        undoStack = [...undoStack.slice(-(MAX_UNDO_DEPTH - 1)), batchBaseScene];
        redoStack = [];
        state = buildState(state.scene);
        emit();
      }

      batchBaseScene = null;
    },
    undo() {
      if (undoStack.length === 0) return;
      const prev = undoStack[undoStack.length - 1]!;
      redoStack = [...redoStack, state.scene];
      undoStack = undoStack.slice(0, -1);
      state = buildState(prev);
      emit();
    },
    redo() {
      if (redoStack.length === 0) return;
      const next = redoStack[redoStack.length - 1]!;
      undoStack = [...undoStack, state.scene];
      redoStack = redoStack.slice(0, -1);
      state = buildState(next);
      emit();
    },
  };
}
