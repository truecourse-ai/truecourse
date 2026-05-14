
// Environment variable boolean string comparison — standard boolean env flag pattern
declare function env(key: string): string | undefined;

const isVisibleInCatalog = (metadata: Record<string, string>) =>
  metadata.visibleInApp === 'true';
