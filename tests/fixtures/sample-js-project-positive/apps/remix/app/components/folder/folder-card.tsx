
// --- require-await FP: async arrow that calls updateFolder returning a Promise (void unawaited) ---
// onClick must be async to satisfy the event handler type, but the internal call is fire-and-forget
declare function useMutation<T, V>(opts: { mutationFn: (vars: V) => Promise<T> }): { mutateAsync: (vars: V) => Promise<T> };

interface Folder { id: string; pinned: boolean; name: string }

function FolderCard({ folder, onMove, onSettings }: { folder: Folder; onMove: (f: Folder) => void; onSettings: (f: Folder) => void }) {
  const { mutateAsync: updateFolder } = useMutation<void, { pinned: boolean }>({
    mutationFn: async (vars) => {
      await fetch(`/api/folders/${folder.id}`, { method: 'PATCH', body: JSON.stringify(vars) });
    },
  });

  return (
    <div>
      <button onClick={async () => updateFolder({ pinned: !folder.pinned })}>
        {folder.pinned ? 'Unpin' : 'Pin'}
      </button>
      <button onClick={() => onMove(folder)}>Move</button>
      <button onClick={() => onSettings(folder)}>Settings</button>
    </div>
  );
}
