/**
 * The pluggable knowledge-connector seam. A connector's only job is to turn a
 * connected tool (Confluence/Jira/…) into a stream of spec docs — metadata via
 * `list()`, body via `fetch()` — plus a cheap `test()` for the settings UI and
 * self-describing `fields` so the UI renders the credential form generically
 * (no per-connector page code). Everything downstream (consolidate, merge,
 * resolve, the provenance ledger) is source-agnostic and reused unchanged.
 *
 * The connector is the ONLY thing that talks to a source, and only at Sync time.
 * The sync engine then PERSISTS each fetched body (content-addressed in the shared
 * `content` table); Process and the doc viewer read those stored bodies back —
 * never the connector.
 */

export type ConnectorKind = 'confluence' | 'jira' | 'notion' | 'linear' | 'gdocs';

/** Lightweight listing — metadata only, no body. Used to enumerate + diff. */
export interface DocRef {
  /** Stable per-doc id in the source tool (e.g. Confluence page id). */
  id: string;
  title: string;
  /** Deep link to the source doc (provenance click-through). */
  url: string;
  /** Source version (e.g. Confluence version.number); undefined ⇒ hash-only diff. */
  version?: string;
  /** ISO timestamp; feeds newest-wins (`lastTouched`). */
  updatedAt: string;
  /** ISO timestamp of creation in the source tool, when it exposes one. */
  createdAt?: string;
}

/** One document's content, as fetched from the source. */
export interface DocContent {
  title: string;
  /** Markdown-ish body (headings preserved so the consolidator can slice it). */
  markdown: string;
}

/**
 * A failed upstream HTTP call from a connector. Carries the numeric status so
 * the route can surface it (e.g. to error tracking) while `message` stays a
 * clean, user-facing string. Generic across connectors — not Confluence-specific.
 */
export class UpstreamHttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  constructor(message: string, status: number, statusText = '') {
    super(message);
    this.name = 'UpstreamHttpError';
    this.status = status;
    this.statusText = statusText;
  }
}

/** A credential/config field the settings UI renders. */
export interface ConnectorField {
  key: string;
  label: string;
  type: 'text' | 'email' | 'password';
  placeholder?: string;
  /** The one secret field (encrypted at rest, masked in the UI). */
  secret?: boolean;
  /**
   * A field the user may leave blank. The settings page's configured-check skips
   * it (a blank optional field never blocks "Connected"), and it's absent from
   * the stored config when left empty.
   */
  optional?: boolean;
}

/**
 * A connector's config is the flat map of its field values. The secret field is
 * split out (encrypted) by the store, then reassembled before list/fetch/test.
 */
export type ConnectorConfig = Record<string, string>;

export interface KnowledgeConnector<Cfg extends ConnectorConfig = ConnectorConfig> {
  readonly kind: ConnectorKind;
  /** Display name + one-line description for the settings list. */
  readonly name: string;
  readonly description: string;
  /** The credential/config fields the UI renders. Exactly one is `secret`. */
  readonly fields: ConnectorField[];
  /** Cheap auth/permission check (throws on failure). Powers the "Test" button. */
  test(cfg: Cfg): Promise<void>;
  /** Enumerate the source's docs (metadata only). */
  list(cfg: Cfg): Promise<DocRef[]>;
  /** Fetch ONE doc's content from the source. */
  fetch(cfg: Cfg, id: string): Promise<DocContent>;
  /** Max ids per fetchMany call. Present iff fetchMany is implemented. */
  readonly fetchBatchLimit?: number;
  /** Batched fetch. Missing ids (deleted upstream mid-sync) are simply absent. */
  fetchMany?(cfg: Cfg, ids: string[]): Promise<Map<string, DocContent>>;
}

/** The key of a connector's secret field (used by the store to encrypt it). */
export function secretFieldKey(connector: KnowledgeConnector): string | undefined {
  return connector.fields.find((f) => f.secret)?.key;
}

/** Reassemble the full connector config from stored non-secret values + the secret token. */
export function connectorConfig(
  connector: KnowledgeConnector,
  config: Record<string, string>,
  token: string | undefined,
): ConnectorConfig {
  const secret = secretFieldKey(connector);
  return { ...config, ...(secret && token ? { [secret]: token } : {}) };
}
