/**
 * tRPC's `useQuery` is non-suspense by default. Errors come back via the
 * `error` field on the returned object — they're never thrown during
 * render, so a React error boundary cannot catch them. The rule must
 * not fire on `useQuery` unless it's specifically suspense-mode.
 *
 * Mirrors documenso's
 *   apps/remix/app/components/dialogs/admin-swap-subscription-dialog.tsx:1
 *   apps/remix/app/components/dialogs/document-move-to-folder-dialog.tsx:1
 */

import { useState } from 'react';

interface QueryResult<T> { data: T | undefined; error: unknown; isLoading: boolean }
interface TrpcOrg {
  find: { useQuery: (args: { id: string }) => QueryResult<{ id: string; name: string }> };
}
interface Trpc { admin: { organisation: TrpcOrg } }

declare const trpc: Trpc;

export function OrgPanel({ orgId }: { readonly orgId: string }): JSX.Element {
  const [count, setCount] = useState(0);
  const { data, error } = trpc.admin.organisation.find.useQuery({ id: orgId });
  if (error !== null && error !== undefined) return <div>Error</div>;
  if (data === undefined) return <div>Loading...</div>;
  return <div onClick={() => setCount(count + 1)}>{data.name} {count}</div>;
}
