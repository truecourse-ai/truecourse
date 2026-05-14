
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
