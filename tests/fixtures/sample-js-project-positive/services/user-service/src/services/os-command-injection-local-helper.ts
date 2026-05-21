// FP shape for `security/deterministic/os-command-injection`: a locally
// defined async helper named `exec`, called fire-and-forget. The file does
// not import `child_process`, so a bare identifier call `exec(...)` is the
// local helper, not a shell command.

interface Search {
  open: boolean;
  triggerOnFocus: boolean;
  query: string;
  fetchOptions: (term: string) => Promise<readonly string[]>;
}

export async function runScheduledSearch(s: Search): Promise<readonly string[]> {
  let results: readonly string[] = [];

  const exec = async (): Promise<void> => {
    if (!s.open) {
      return;
    }
    if (s.triggerOnFocus) {
      results = await s.fetchOptions(s.query);
      return;
    }
    if (s.query.length > 0) {
      results = await s.fetchOptions(s.query);
    }
  };

  await exec();
  return results;
}
