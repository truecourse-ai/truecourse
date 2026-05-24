/**
 * Short hyphenated single-token strings used as standard-library /
 * API arguments — encoding names, region IDs, kind discriminants —
 * are framework identifiers, not domain strings worth extracting.
 * They are conceptually identical to the snake_case / camelCase
 * tokens the rule already exempts; only the spelling differs.
 */

declare function readBlob(path: string, encoding: string): string;
declare function writeBlob(path: string, data: string, encoding: string): void;
declare function pingRegion(region: string): Promise<void>;

export function loadAll(paths: readonly string[]): readonly string[] {
  return [
    readBlob(paths[0], 'utf-8'),
    readBlob(paths[1], 'utf-8'),
    readBlob(paths[2], 'utf-8'),
  ];
}

export function saveAll(entries: ReadonlyArray<readonly [string, string]>): void {
  for (const [path, data] of entries) {
    writeBlob(path, data, 'utf-8');
  }
}

type Outcome = { kind: 'in-flight' | 'long-poll' | 'short-poll' };

declare function dispatch(kind: Outcome['kind']): void;

export function reportAll(): void {
  dispatch('in-flight');
  dispatch('in-flight');
  dispatch('in-flight');
}

export async function probeRegions(): Promise<void> {
  await pingRegion('us-east-1');
  await pingRegion('us-east-1');
  await pingRegion('us-east-1');
}
