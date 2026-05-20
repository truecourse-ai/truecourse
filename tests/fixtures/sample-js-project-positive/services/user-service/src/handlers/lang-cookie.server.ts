// Remix `*.server.ts` module — imported by route loaders, not a process
// entry. The old visitor matched `.includes('server.')` on the path.

export function getLangCookieName(): string {
  return 'i18n-lang';
}
