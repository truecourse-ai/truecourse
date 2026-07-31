/**
 * Typed failures of the web-sources engine. Each carries a message that is
 * already user-facing — the CLI and the dashboard print it verbatim rather than
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

/** A source with this id (or this llms.txt URL) is already registered. */
export class SourceExistsError extends Error {
  constructor(
    readonly id: string,
    detail: string,
  ) {
    super(detail);
    this.name = 'SourceExistsError';
  }
}

/** No source with this id is registered. */
export class SourceNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`no registered spec source "${id}"`);
    this.name = 'SourceNotFoundError';
  }
}

/**
 * `sources.json` exists but is unparseable. Deliberately NOT fail-soft (unlike
 * `decisions.json` / `corpus.json`): the registry owns committed files on disk,
 * so treating a corrupt one as empty would orphan every snapshot it names on the
 * next write.
 */
export class SourcesFileError extends Error {
  constructor(
    readonly file: string,
    detail: string,
  ) {
    super(`${file} is not a valid sources registry (${detail}) — fix or delete it`);
    this.name = 'SourcesFileError';
  }
}

/** A page URL mapped outside its source's snapshot directory. */
export class SourcePathError extends Error {
  constructor(readonly url: string) {
    super(`page URL maps outside its source directory: ${url}`);
    this.name = 'SourcePathError';
  }
}
