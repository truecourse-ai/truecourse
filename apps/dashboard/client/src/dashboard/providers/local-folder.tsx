/**
 * Local folder: a directory on this machine, connected as a repository.
 *
 * Offered only when the server runs locally, because that is the only time it
 * and the person using it share a filesystem. It is a provider like any other
 * — the same list, the same mark, the same connect dialog — and what makes it
 * different is only what its step asks for: a path instead of an account.
 *
 * Nothing is copied here. Connecting writes the repository row; a RUN copies
 * the folder into its own directory and never writes into the original.
 */

import type { LocalRepositoriesResponse, LocalRepositorySummary } from '@truecourse/shared';
import type { RepositoryProvider } from '@/dashboard/shell/registry';
import { fetchApi } from '@/lib/api';
import folder from '@/dashboard/ui/logos/folder.svg';

/** The folders on this machine this workspace has connected. */
export async function fetchLocalRepos(): Promise<LocalRepositorySummary[]> {
  return (await fetchApi<LocalRepositoriesResponse>('/api/local/repos')).repos;
}

/**
 * Connect a folder. Rejects with the server's reason: a path that is not
 * there, or holds no history to identify a run by, is the whole answer.
 */
export function linkLocalRepo(path: string): Promise<{ repoFullName: string }> {
  return fetchApi<{ repoFullName: string }>('/api/local/repos', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

function FolderPicker({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <div>
      <label htmlFor="local-folder-path" className="block text-[11px] text-muted-foreground">
        The folder's full path on this machine
      </label>
      <input
        id="local-folder-path"
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="/Users/you/code/orders-api"
        spellCheck={false}
        autoComplete="off"
        className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-primary"
      />
      <p className="mt-2 text-[11px] text-muted-foreground">
        Every run works on a copy of the folder, so nothing is written into it.
      </p>
    </div>
  );
}

export const localFolder: RepositoryProvider = {
  id: 'local',
  name: 'Local folder',
  logo: folder,
  mode: 'local',
  connect: {
    summary: 'A folder on this machine',
    Picker: FolderPicker,
    link: (path) => linkLocalRepo(path),
  },
};
