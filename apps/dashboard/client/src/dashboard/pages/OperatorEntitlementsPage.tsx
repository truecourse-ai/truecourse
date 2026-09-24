/**
 * The operator's Entitlements page: every workspace, and which of the
 * enterprise features it may use.
 *
 * TrueCourse staff only. It is not in the sidebar and the routes behind it
 * answer 404 to anyone else, so a member who lands here is told there is
 * nothing at this address rather than shown the shape of what they cannot have.
 *
 * One toggle per feature per workspace, because the movements are a set of
 * three independent yes-or-nos and nothing else. A GRANT is the common act and
 * takes ONE click. A REVOKE asks first and says what it will stop: the
 * workspace's sources that read through the feature pause with the reason, and
 * their documents stay, so granting it back is a Resume.
 */

import { useCallback, useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import {
  CONTEXT_SOURCE_KIND_LABEL,
  ENTERPRISE_FEATURES,
  ENTERPRISE_FEATURE_LABEL,
  ENTERPRISE_FEATURE_SOURCE_KINDS,
  type EnterpriseFeature,
  type OperatorEntitlementRow,
} from '@truecourse/shared';
import { EmptyState } from '@/components/ui/empty-state';
import { fetchOperatorEntitlements, grantEntitlement, revokeEntitlement } from '@/lib/api';
import { useAuth } from '@/auth/AuthContext';
import { EntityList } from '@/dashboard/ui/entity-list';
import { PageHeader } from '@/dashboard/ui/bits';
import { HoverPopover } from '@/dashboard/ui/hover-popover';
import { StatusWord } from '@/dashboard/ui/status-word';

const CHIP =
  'rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-50';

/** Which revoke is waiting to be confirmed. */
interface Pending {
  workspaceOrgId: string;
  feature: EnterpriseFeature;
}

/** What the workspace is called: its name where anyone could give it one. */
function nameOf(row: OperatorEntitlementRow): string {
  return row.workspaceName ?? row.workspaceOrgId;
}

/**
 * What a revoke of this feature stops, in the product's own words for the
 * kinds — "Jira and Confluence" — or null for a feature that feeds no source.
 */
function pausedKinds(feature: EnterpriseFeature): string | null {
  const labels = ENTERPRISE_FEATURE_SOURCE_KINDS[feature].map(
    (kind) => CONTEXT_SOURCE_KIND_LABEL[kind],
  );
  if (labels.length === 0) return null;
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

export default function OperatorEntitlementsPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<OperatorEntitlementRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const read = useCallback(() => {
    void fetchOperatorEntitlements()
      .then((next) => {
        setRows(next.workspaces);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(read, [read]);

  /**
   * One movement. The answer carries what the workspace holds afterwards, so
   * the row is set from it rather than the whole page read again.
   */
  const move = useCallback(
    (row: OperatorEntitlementRow, feature: EnterpriseFeature, movement: 'grant' | 'revoke') => {
      const label = ENTERPRISE_FEATURE_LABEL[feature];
      setBusy(`${row.workspaceOrgId}:${feature}`);
      setError(null);
      setOutcome(null);
      const body = { workspaceOrgId: row.workspaceOrgId, feature };
      const sent = movement === 'grant' ? grantEntitlement(body) : revokeEntitlement(body);
      void sent
        .then((next) => {
          setRows((current) =>
            (current ?? []).map((item) =>
              item.workspaceOrgId === next.workspaceOrgId
                ? { ...item, features: next.features }
                : item,
            ),
          );
          setPending(null);
          const paused = next.paused?.length ?? 0;
          setOutcome(
            movement === 'grant'
              ? `Granted ${label} to ${nameOf(row)}`
              : `Revoked ${label} from ${nameOf(row)}${
                  paused > 0 ? ` · ${paused} ${paused === 1 ? 'source' : 'sources'} paused` : ''
                }`,
          );
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setBusy(null));
    },
    [],
  );

  // The page is the operator's; a member reaching it is told the same thing the
  // routes tell them.
  if (!user?.isOperator) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader title="Not found" />
        <div className="min-h-0 flex-1 py-10">
          <EmptyState icon={KeyRound} title="Nothing here" body="There is no such page." />
        </div>
      </div>
    );
  }

  const pendingRow = pending
    ? (rows ?? []).find((row) => row.workspaceOrgId === pending.workspaceOrgId)
    : undefined;
  const pendingPauses = pending ? pausedKinds(pending.feature) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Entitlements" />

      {error && (
        <p className="border-b border-border px-6 py-3 text-[11px] text-destructive">{error}</p>
      )}

      {outcome && (
        <p className="border-b border-border px-6 py-3 text-[11px] text-muted-foreground">
          {outcome}
        </p>
      )}

      {pending && pendingRow && (
        <div
          role="group"
          aria-label={`Revoke ${ENTERPRISE_FEATURE_LABEL[pending.feature]}`}
          className="border-b border-border px-6 py-4"
        >
          <p className="max-w-3xl text-[11px] text-muted-foreground">
            Revoke{' '}
            <span className="font-medium text-foreground">
              {ENTERPRISE_FEATURE_LABEL[pending.feature]}
            </span>{' '}
            from{' '}
            <span
              className={`text-foreground${pendingRow.workspaceName ? '' : ' font-mono'}`}
            >
              {nameOf(pendingRow)}
            </span>
            ?{' '}
            {pendingPauses
              ? `Its ${pendingPauses} sources pause with the reason and keep their documents, so granting it back is a Resume.`
              : 'It stops being offered at once.'}
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => move(pendingRow, pending.feature, 'revoke')}
              disabled={busy !== null}
              className="rounded bg-destructive px-2 py-1 text-[11px] font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Revoking…' : 'Revoke'}
            </button>
            <button
              type="button"
              onClick={() => setPending(null)}
              className="rounded border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted/60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {rows !== null && rows.length === 0 ? (
        <div className="min-h-0 flex-1 py-10">
          <EmptyState
            icon={KeyRound}
            title="No workspaces yet"
            body="Nothing has connected a repository or saved a provider."
          />
        </div>
      ) : (
        <EntityList<OperatorEntitlementRow>
          variant="embedded"
          label="Workspaces"
          items={rows ?? []}
          itemId={(row) => row.workspaceOrgId}
          activeId={null}
          rowInteractive={() => false}
          loading={rows === null}
          emptyText="No workspaces yet."
          renderRow={(row) => {
            const held = new Set(row.features);
            return (
              <>
                <span className="flex w-full items-center gap-2">
                  <span
                    className={`min-w-0 flex-1 truncate text-[13px] font-medium text-foreground${
                      row.workspaceName ? '' : ' font-mono'
                    }`}
                  >
                    {nameOf(row)}
                  </span>
                  {row.features.length > 0 ? (
                    <StatusWord tone="success" word="Granted" />
                  ) : (
                    <StatusWord tone="neutral" word="Nothing granted" />
                  )}
                </span>
                <span className="flex w-full items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="min-w-0 truncate">
                    {row.workspaceName && <span className="font-mono">{row.workspaceOrgId}</span>}
                    {row.features.length > 0 && (
                      <>
                        {row.workspaceName ? ' · ' : ''}
                        {row.features.map((feature) => ENTERPRISE_FEATURE_LABEL[feature]).join(' · ')}
                      </>
                    )}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-1.5">
                    {ENTERPRISE_FEATURES.map((feature) => {
                      const on = held.has(feature);
                      const label = ENTERPRISE_FEATURE_LABEL[feature];
                      const pauses = pausedKinds(feature);
                      return (
                        <HoverPopover
                          key={feature}
                          portal
                          side="top"
                          width="narrow"
                          content={
                            on
                              ? `Revoke ${label}.${
                                  pauses ? ` Its ${pauses} sources pause; the documents stay.` : ''
                                }`
                              : `Grant ${label} to this workspace.`
                          }
                        >
                          <button
                            type="button"
                            aria-pressed={on}
                            disabled={busy === `${row.workspaceOrgId}:${feature}`}
                            onClick={() =>
                              on
                                ? setPending({ workspaceOrgId: row.workspaceOrgId, feature })
                                : move(row, feature, 'grant')
                            }
                            className={`${CHIP} ${
                              on
                                ? 'bg-primary text-primary-foreground ring-1 ring-inset ring-current'
                                : 'bg-muted text-foreground'
                            }`}
                          >
                            {label}
                          </button>
                        </HoverPopover>
                      );
                    })}
                  </span>
                </span>
              </>
            );
          }}
        />
      )}
    </div>
  );
}
