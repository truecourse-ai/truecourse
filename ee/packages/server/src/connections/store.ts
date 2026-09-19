/**
 * The workspace's ACCOUNT CONNECTIONS — one row per (workspace, account) over
 * `integration_connections`, the API token encrypted at rest under the server's
 * master secret.
 *
 * A connection is the ACCOUNT, not what it reads: an Atlassian site is one
 * login whose token reads both Jira and Confluence, so there is one row for it
 * and the sources that read through it are Context's rows. Two reads,
 * deliberately separate (the shape `PgLlmConfigStore` keeps): a masked view for
 * the page, which never carries a secret, and a decrypted connection for the
 * driver about to call Atlassian with it.
 *
 * `pending` is left untouched and unread: nothing sweeps.
 */

import { and, eq, sql } from 'drizzle-orm';
import { integrationConnections, type Db } from '@truecourse/db';
import { decryptSecret, encryptSecret, maskKey } from '@truecourse/data-store';
import {
  CONTEXT_CONNECTION_KINDS,
  CONTEXT_CONNECTION_LABEL,
  type ContextConnectionInput,
  type ContextConnectionProvider,
  type ContextConnectionView,
} from '@truecourse/shared';
import { ContextConfigError } from '@truecourse/core/services/context';

/** A connection with its token in clear — built only to make a call with it. */
export interface AtlassianConnection {
  /** The site base, without a trailing slash: `https://acme.atlassian.net`. */
  baseUrl: string;
  accountEmail: string;
  apiToken: string;
}

/**
 * The workspace has not connected this account (or its connection lost its
 * token). A {@link ContextConfigError}, because that is what it is from
 * Context's side: a scope this workspace cannot read, which the routes answer
 * as a 400 in these words and a sync records as the source's failure note.
 */
export class ConnectionMissingError extends ContextConfigError {
  constructor(readonly provider: ContextConnectionProvider) {
    super(
      `This workspace has no ${CONTEXT_CONNECTION_LABEL[provider]} connection. ` +
        'Connect the account in Settings › Connections.',
    );
    this.name = 'ConnectionMissingError';
  }
}

/** The row's non-secret half, as it is stored. */
interface StoredConfig {
  baseUrl?: string;
  accountEmail?: string;
}

/** A site base URL as it is stored: absolute, https, no trailing slash. */
export function normalizeBaseUrl(raw: string): string {
  const value = raw.trim().replace(/\/+$/, '');
  if (!value) throw new Error('The site URL is required.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('The site URL must be a full URL, e.g. https://your-site.atlassian.net.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('The site URL must be a full URL, e.g. https://your-site.atlassian.net.');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export class ConnectionStore {
  constructor(
    private readonly db: Db,
    private readonly masterSecret: string,
  ) {}

  private async getRow(org: string, provider: ContextConnectionProvider) {
    const rows = await this.db
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.workspaceOrgId, org),
          eq(integrationConnections.provider, provider),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** The masked view the page reads. Absent rows are answered as unconnected. */
  async getView(
    org: string,
    provider: ContextConnectionProvider,
  ): Promise<ContextConnectionView> {
    const kinds = [...CONTEXT_CONNECTION_KINDS[provider]];
    const row = await this.getRow(org, provider);
    if (!row) {
      return {
        provider,
        kinds,
        connected: false,
        baseUrl: '',
        accountEmail: '',
        tokenMask: null,
        updatedAt: null,
      };
    }
    let tokenMask: string | null = null;
    if (row.tokenEnc) {
      // A rotated or mismatched master secret must never crash or leak.
      try {
        tokenMask = maskKey(decryptSecret(row.tokenEnc, this.masterSecret));
      } catch {
        tokenMask = '••••';
      }
    }
    const config = (row.config as StoredConfig | null) ?? {};
    return {
      provider,
      kinds,
      connected: row.tokenEnc != null,
      baseUrl: config.baseUrl ?? '',
      accountEmail: config.accountEmail ?? '',
      tokenMask,
      updatedAt: row.updatedAt,
    };
  }

  /** The connection with its token DECRYPTED, or null when there is none to make. */
  async getConnection(
    org: string,
    provider: ContextConnectionProvider,
  ): Promise<AtlassianConnection | null> {
    const row = await this.getRow(org, provider);
    if (!row?.tokenEnc) return null;
    const config = (row.config as StoredConfig | null) ?? {};
    if (!config.baseUrl || !config.accountEmail) return null;
    return {
      baseUrl: config.baseUrl,
      accountEmail: config.accountEmail,
      apiToken: decryptSecret(row.tokenEnc, this.masterSecret),
    };
  }

  /** The same, refusing rather than handing a driver half a connection. */
  async requireConnection(
    org: string,
    provider: ContextConnectionProvider,
  ): Promise<AtlassianConnection> {
    const connection = await this.getConnection(org, provider);
    if (!connection) throw new ConnectionMissingError(provider);
    return connection;
  }

  /** Connect or re-save. An omitted token keeps the stored one. */
  async save(
    org: string,
    provider: ContextConnectionProvider,
    input: ContextConnectionInput,
  ): Promise<void> {
    const config: Record<string, string> = {
      baseUrl: normalizeBaseUrl(input.baseUrl),
      accountEmail: input.accountEmail.trim(),
    };
    const tokenEnc = input.apiToken ? encryptSecret(input.apiToken, this.masterSecret) : null;
    const now = new Date().toISOString();
    await this.db
      .insert(integrationConnections)
      .values({ workspaceOrgId: org, provider, config, tokenEnc, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [integrationConnections.workspaceOrgId, integrationConnections.provider],
        set: {
          config: sql`excluded.config`,
          // An omitted token (null) keeps the stored one; a new token replaces it.
          tokenEnc: sql`coalesce(excluded.token_enc, ${integrationConnections.tokenEnc})`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  async remove(org: string, provider: ContextConnectionProvider): Promise<void> {
    await this.db
      .delete(integrationConnections)
      .where(
        and(
          eq(integrationConnections.workspaceOrgId, org),
          eq(integrationConnections.provider, provider),
        ),
      );
  }
}
