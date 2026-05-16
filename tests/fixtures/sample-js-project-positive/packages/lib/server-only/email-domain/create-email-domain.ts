
// Replace dots/underscores with hyphens in DNS selector — ASCII literal chars, unicode flag irrelevant.
export function buildDkimSelector(orgId: string): string {
  return `myservice-${orgId}`.replace(/[_.]/g, '-');
}
