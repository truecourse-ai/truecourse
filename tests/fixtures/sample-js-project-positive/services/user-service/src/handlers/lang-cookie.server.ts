// Paraphrased from documenso/documenso (apps/remix/app/storage/lang-cookie.server.ts).
// Remix `*.server.ts` module — imported by route loaders, not a process
// entry. Old visitor matched `.includes('server.')` on the path.

export function getLangCookieName(): string {
  return 'i18n-lang';
}
