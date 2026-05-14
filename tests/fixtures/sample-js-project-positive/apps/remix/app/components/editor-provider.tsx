
// --- react-readonly-props FP: children React.ReactNode ---
declare namespace React { type ReactNode = unknown; }
declare function createContext<T>(val: T | null): { Provider: (p: { value: T | null; children: React.ReactNode }) => JSX.Element };
declare function useContext<T>(ctx: { Provider: unknown }): T | null;

interface EditorProviderProps {
  children: React.ReactNode;
  config?: { autosave?: boolean };
}

function EditorProvider({ children, config }: EditorProviderProps) {
  return <div data-config={JSON.stringify(config)}>{children}</div>;
}


// Hook accepting a typed async callback — useEnvelopeAutosave(async (fields: TLocalField[]) => {...}) is valid, no type mismatch
type TEnvelopeField = { id: string; type: string; value: string; required: boolean };
declare function useEnvelopeAutosave(callback: (fields: TEnvelopeField[]) => Promise<void>): void;
declare function persistEnvelopeFields(fields: TEnvelopeField[]): Promise<void>;

function EnvelopeEditorProvider({ children }: { children: unknown }) {
  useEnvelopeAutosave(async (localFields: TEnvelopeField[]) => {
    await persistEnvelopeFields(localFields);
  });

  return <div>{children}</div>;
}

