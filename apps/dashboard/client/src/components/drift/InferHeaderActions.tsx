/**
 * Section-level action button for the Inferred tab — runs inference
 * (`POST /inferred/run`), reverse-engineering undocumented decisions from code
 * into `_inferred/`. Like `ContractsHeaderActions`/`VerifyHeaderActions`:
 * rendered in the page Header, never below the per-tab strip.
 */

import { Loader2, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface InferHeaderActionsProps {
  isRunning: boolean;
  onRun: () => void;
  /** Infer requires a git repo (like Analyze/Generate); hide it when absent. */
  isGitRepo?: boolean;
}

export function InferHeaderActions({ isRunning, onRun, isGitRepo = true }: InferHeaderActionsProps) {
  if (!isGitRepo) return null;
  return (
    <Button size="sm" onClick={onRun} disabled={isRunning}>
      {isRunning ? (
        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
      ) : (
        <Lightbulb className="mr-2 h-3.5 w-3.5" />
      )}
      {isRunning ? 'Inferring...' : 'Infer'}
    </Button>
  );
}
