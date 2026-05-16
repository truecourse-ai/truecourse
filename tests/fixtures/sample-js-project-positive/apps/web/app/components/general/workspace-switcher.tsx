
declare const cn: (...args: any[]) => string;
declare const workspaces: Array<{ id: string; name: string; url: string; currentRole: string }>;
declare const currentWorkspace: { id: string } | null;
declare let hoveredId: string | null;

function WorkspaceSwitcherMenu() {
  return (
    workspaces.map((ws) => ({
      key: ws.id,
      className: cn(
        'w-full px-4 py-2 text-muted-foreground',
        ws.id === currentWorkspace?.id && !hoveredId && 'bg-accent',
        ws.id === hoveredId && 'bg-accent',
      ),
      label: ws.name,
    }))
  );
}
