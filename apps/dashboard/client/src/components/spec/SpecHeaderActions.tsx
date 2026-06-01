/**
 * Section-level action buttons for the Spec tab, rendered inside the
 * page Header alongside Analyze. Pulls state and handlers from
 * SpecContext — must be mounted under `<SpecProvider>`.
 */

import { Loader2, Play, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSpec } from './SpecContext';

export function SpecHeaderActions() {
  const { scan, loading, refresh, acceptAllDefaults } = useSpec();
  const hasOpen = (scan?.openConflicts.length ?? 0) > 0;
  const disabled = !scan;

  return (
    <>
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
