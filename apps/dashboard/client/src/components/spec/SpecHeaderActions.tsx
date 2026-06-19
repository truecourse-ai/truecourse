/**
 * Section-level action buttons for the Spec tab, rendered inside the
 * page Header alongside Analyze. Pulls state and handlers from
 * SpecContext — must be mounted under `<SpecProvider>`.
 */

import { Loader2, Play, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSpec } from './SpecContext';

interface SpecHeaderActionsProps {
  /** On-demand Scan requires a git working tree (OSS); hidden otherwise. */
  isGitRepo?: boolean;
  /** Hosted (enterprise) repo: no working tree, but conflicts ARE resolvable
   *  (server re-merges from stored claims) — so keep the resolve actions. */
  hosted?: boolean;
}

export function SpecHeaderActions({ isGitRepo = true, hosted = false }: SpecHeaderActionsProps = {}) {
  const { scan, loading, refresh, acceptAllDefaults, supportsRescan } = useSpec();
  const hasOpen = (scan?.openConflicts.length ?? 0) > 0;
  const disabled = !scan;

  // A non-git LOCAL folder has no scan/resolve (matches the hidden Analyze
  // button). Hosted repos have no working tree either, but still resolve — the
  // Scan button below is gated on `supportsRescan` (off hosted), while
  // "Accept all defaults" stays available.
  if (!isGitRepo && !hosted) return null;

  return (
    <>
      {/* On-demand scan applies only where the docs live on the server (repos).
          Workspace Knowledge is re-processed by re-uploading, so its Scan
          button is hidden. */}
      {supportsRescan && (
        <Button
          size="sm"
          variant="outline"
          onClick={refresh}
          disabled={loading}
          title="Discover docs, extract claims, surface conflicts"
        >
          {loading ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="mr-2 h-3.5 w-3.5" />
          )}
          {loading ? 'Scanning...' : 'Scan'}
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        onClick={acceptAllDefaults}
        disabled={disabled || !hasOpen || loading}
        title="Accept the engine's default pick on every open conflict (chains first, then content)"
      >
        <Wand2 className="mr-2 h-3.5 w-3.5" />
        Accept all defaults
      </Button>
    </>
  );
}
