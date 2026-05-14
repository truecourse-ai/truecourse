
// --- react-readonly-props FP: children ReactNode in context provider ---
declare namespace React { type ReactNode = unknown; }

interface WorkspaceProviderProps {
  children: React.ReactNode;
  workspaceId: string;
}

function WorkspaceProvider({ children, workspaceId }: WorkspaceProviderProps) {
  return <div data-workspace={workspaceId}>{children}</div>;
}
