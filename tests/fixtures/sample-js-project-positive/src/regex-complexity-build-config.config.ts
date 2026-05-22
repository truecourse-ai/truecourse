/**
 * Positive fixture for code-quality/deterministic/regex-complexity.
 *
 * Build-tool config files (anything matching `*.config.{ts,js,…}`)
 * commonly contain regexes that match bundler conventions — virtual
 * modules, query suffixes, asset paths. These are not application logic
 * that benefits from being extracted further, so the rule should skip
 * config files entirely.
 */

type BundlerOptions = {
  excludeQueries?: RegExp;
};

declare function defineBundler(options: BundlerOptions): BundlerOptions;

export default defineBundler({
  excludeQueries: /\?(?:inline|raw|url|no-inline|import(?:&(?:inline|raw|url|no-inline))?)$/u,
});
