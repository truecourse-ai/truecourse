/**
 * Canonical artifact identity — the single source of truth for an artifact's
 * identity string across the whole generate pipeline.
 *
 * The bug this fixes: the identity used to "float". The string the LLM proposed
 * was matched one way (a tolerant merge key), written into the `.tc` header
 * another way (verbatim), and turned into a filename a third way — so two runs
 * that proposed cosmetically-different identities (`POST /api/orders` vs
 * `POST /api/orders/`) could dedup the same but land in different files with
 * different header text, churning the tree.
 *
 * The fix: run every LLM-proposed identity through {@link canonicalIdentity}
 * once, right after parsing, and derive both the merge key and the filename
 * slug from that one canonical string. One artifact, one identity, everywhere.
 */

const HTTP_METHOD = /^(get|post|put|patch|delete|head|options)\s+(\S.*)$/i;

/**
 * Light, structure-preserving canonicalization of an artifact identity. Folds
 * only BENIGN drift so two wordings of the same thing collapse, while preserving
 * everything downstream relies on — type-name casing (`Order`), dotted segment
 * paths (`Order.status`), and the `METHOD /path` shape:
 *
 *  - collapse internal whitespace to single spaces;
 *  - for HTTP operations: uppercase the method, drop a trailing slash, and fold
 *    Express-style `:id` path params to OpenAPI-style `{id}`.
 *
 * It deliberately does NOT lowercase or slug type names — those are load-bearing
 * in cross-references (`Entity:Order`) and in the `.tc` header.
 */
export function canonicalIdentity(_kind: string, identity: string): string {
  let id = identity.trim().replace(/\s+/g, ' ');
  const op = HTTP_METHOD.exec(id);
  if (op) {
    const path = op[2].replace(/\/+$/, '').replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
    id = `${op[1].toUpperCase()} ${path}`;
  }
  return id;
}

/**
 * The single filename-slug rule, derived from a (canonical) identity. Lowercase;
 * keep dots as segment separators; collapse every other run of non-alphanumerics
 * to one dash; trim stray separators. This replaces the writer's old ad-hoc
 * slugger so a filename can never disagree with the identity it came from.
 */
export function slugIdentity(identity: string): string {
  return identity
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-') // spaces, slashes, punctuation → dash (dots kept)
    .replace(/-*\.-*/g, '.')      // tidy any dashes hugging a dot down to the dot
    .replace(/-{2,}/g, '-')       // collapse repeated dashes
    .replace(/^[-.]+|[-.]+$/g, ''); // trim leading/trailing separators
}
