
// FF05 — JSX onMouseEnter event handler with setState; types match
declare function useState<T>(init: T): [T, (v: T) => void];
declare const workspaces: Array<{ id: string; name: string }>;

function WorkspaceSwitcher() {
  const [hoveredWorkspaceId, setHoveredWorkspaceId] = useState<string | null>(null);
  return (
    <ul>
      {workspaces.map((ws) => (
        <li
          key={ws.id}
          onMouseEnter={() => setHoveredWorkspaceId(ws.id)}
          onMouseLeave={() => setHoveredWorkspaceId(null)}
        >
          {ws.name}
        </li>
      ))}
    </ul>
  );
}



// FP shape f9c524162ca9: emailSettingsKeys.map() rendering label-value pairs — no type mismatch
declare const emailSettingsKeys: Array<string>;
declare const EMAIL_SETTINGS_LABELS: Record<string, string>;
declare const parsedEmailSettings: { success: true; data: Record<string, boolean> } | { success: false };
declare const _: (msg: string) => string;
declare const isTeam: boolean;

function EmailSettingsDisplay() {
  if (!isTeam || !parsedEmailSettings.success) return null;
  return (
    <div className="mt-1 space-y-1 pr-3 pb-2 text-xs">
      {emailSettingsKeys.map((key) => (
        <div key={key} className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">{_(EMAIL_SETTINGS_LABELS[key])}</span>
          <span>{(parsedEmailSettings as { success: true; data: Record<string, boolean> }).data[key] ? 'On' : 'Off'}</span>
        </div>
      ))}
    </div>
  );
}
