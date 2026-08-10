/**
 * Real await-in-loop bug — independent items fetched serially in a
 * `for-of`. These calls don't share connections, don't have ordering
 * constraints, and don't pace anything. They should be batched with
 * Promise.all.
 */

declare function fetchProfile(id: string): Promise<{ id: string; name: string }>;

export async function loadProfiles(ids: ReadonlyArray<string>): Promise<{ id: string; name: string }[]> {
  const profiles: { id: string; name: string }[] = [];
  for (const id of ids) {
    // VIOLATION: bugs/deterministic/await-in-loop
    const profile = await fetchProfile(id);
    profiles.push(profile);
  }
  return profiles;
}
