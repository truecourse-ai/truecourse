
// --- invalid-void-type shape: mixed valid void uses (Promise<void> + () => void) ---
// `Promise<void>` is idiomatic for async callbacks with no meaningful return;
// `() => void` is standard for cleanup/unregister functions. Neither is invalid.
interface EditorProviderContext {
  saveEnvelope: () => Promise<void>;
  registerFlushCallback: (key: string, fn: () => Promise<void>) => () => void;
  registerMutation: (p: Promise<unknown>) => void;
  navigateTo: (step: string) => void;
}

declare function useEditorContext(): EditorProviderContext;
