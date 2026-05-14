
// URL search parameter name used to read a comma-separated list; empty-string filter is idiomatic.
declare const searchParams: URLSearchParams | null;

export function parseSenderIdsFromUrl(): string[] {
  return (searchParams?.get('senderIds') ?? '').split(',').filter((value) => value !== '');
}
