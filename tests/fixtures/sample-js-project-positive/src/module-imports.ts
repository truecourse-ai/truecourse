/**
 * Module import patterns that should NOT trigger
 * architecture/deterministic/cross-service-internal-import.
 *
 * These mirror real monorepo conventions:
 * - Imports from a shared UI library (e.g. @documenso/ui/primitives/*)
 *   are public API surface, not protected internals.
 * - Imports from a shared tRPC library (@documenso/trpc/server/*) are
 *   designed for cross-app consumption, not internal-only modules.
 * - Imports of seed/router utilities from a shared package, used by
 *   tooling code, are not production service boundaries.
 * - Imports of external npm packages (e.g. react-router) are framework
 *   modules with no monorepo service boundary at all.
 */

// Mode: shared-ui-library-subpath
// @documenso/ui is a shared workspace package whose /primitives/* and
// /components/* sub-paths are its public API.
declare module '@documenso/ui/primitives/dialog' {
  export const Dialog: (props: { open: boolean; children: unknown }) => unknown;
  export const DialogContent: (props: { children: unknown }) => unknown;
  export const DialogTitle: (props: { children: unknown }) => unknown;
}
declare module '@documenso/ui/primitives/use-toast' {
  export function useToast(): { toast: (opts: { title: string }) => void };
}
declare module '@documenso/ui/components/data-table' {
  export const DataTable: <T>(props: { rows: T[] }) => unknown;
}

import { Dialog, DialogContent, DialogTitle } from '@documenso/ui/primitives/dialog';
import { useToast } from '@documenso/ui/primitives/use-toast';
import { DataTable } from '@documenso/ui/components/data-table';

export function AccountDeleteDialog(open: boolean, rows: { id: string }[]): unknown {
  const { toast } = useToast();
  toast({ title: 'Account scheduled for deletion' });
  return Dialog({
    open,
    children: DialogContent({
      children: [DialogTitle({ children: 'Delete account' }), DataTable({ rows })],
    }),
  });
}

// Mode: shared-trpc-library
// @documenso/trpc is a shared workspace package (packages/trpc), not a
// bounded service; createTrpcContext is a public utility for cross-app
// consumption.
declare module '@documenso/trpc/server' {
  export interface TrpcContext { userId: string | null }
  export function createTrpcContext(req: { headers: Record<string, string> }): Promise<TrpcContext>;
}

import { createTrpcContext, type TrpcContext } from '@documenso/trpc/server';

export async function buildOpenApiContext(req: { headers: Record<string, string> }): Promise<TrpcContext> {
  return createTrpcContext(req);
}

// Mode: dev-seed-tooling
// createTeamMembers is exposed from a shared package's router for use by
// dev seed scripts; it is tooling, not a production service boundary.
declare module '@documenso/trpc/server/team-router' {
  export function createTeamMembers(input: { teamId: number; count: number }): Promise<void>;
}

import { createTeamMembers } from '@documenso/trpc/server/team-router';

export async function seedDemoTeam(teamId: number): Promise<void> {
  await createTeamMembers({ teamId, count: 25 });
}

// Mode: external-npm-package
// react-router is a standard external npm package, not an internal layer
// of any service in the monorepo.
declare module 'react-router' {
  export interface Location { pathname: string; search: string }
  export function useLocation(): Location;
  export function useNavigate(): (to: string) => void;
}

import { useLocation, useNavigate } from 'react-router';

export function currentPath(): string {
  const location = useLocation();
  const navigate = useNavigate();
  if (location.pathname === '/') navigate('/home');
  return location.pathname + location.search;
}
