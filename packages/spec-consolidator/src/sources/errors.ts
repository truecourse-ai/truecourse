/**
 * Typed failures of the web-sources engine. Each carries a message that is
 * already user-facing — the dashboard prints it verbatim rather than
 * re-deriving a reason from an error string.
 */

/** The URL the user supplied is not an llms.txt URL (or not http(s) at all). */
export class InvalidSourceUrlError extends Error {
  constructor(readonly url: string) {
    super(
      `not an llms.txt URL: ${url} — pass the site's llms.txt directly, e.g. https://docs.strapi.io/llms.txt`,
    );
    this.name = 'InvalidSourceUrlError';
  }
}

/** The llms.txt could not be fetched, or carried nothing parseable. */
export class LlmsTxtFetchError extends Error {
  constructor(
    readonly url: string,
    detail: string,
  ) {
    super(`could not read ${url}: ${detail}`);
    this.name = 'LlmsTxtFetchError';
  }
}

/** A page URL mapped outside the source it belongs to. */
export class SourcePathError extends Error {
  constructor(readonly url: string) {
    super(`page URL maps outside its source: ${url}`);
    this.name = 'SourcePathError';
  }
}
