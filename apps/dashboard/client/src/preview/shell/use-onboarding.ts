/**
 * The two things a workspace needs before it is one: a context source and a
 * connected repository. Home shows the checkpoints and the side menu tracks
 * them, both from this one reading, which is live: adding a source or
 * connecting a repository flips it without a reload.
 */

import { useContextSignal, useContextSources } from './use-context';
import { usePreviewState } from './preview-state';

export interface OnboardingState {
  /** Both reads have landed; before that nothing here is honest. */
  ready: boolean;
  hasContext: boolean;
  hasRepo: boolean;
  /** Both checkpoints done: the workspace is one. */
  done: boolean;
  /** The context change signal, for pages that re-read on it. */
  signal: number;
}

export function useOnboarding(): OnboardingState {
  const signal = useContextSignal();
  const { sources } = useContextSources(signal);
  const { repos, reposLoaded } = usePreviewState();
  const ready = sources !== null && reposLoaded;
  const hasContext = (sources?.length ?? 0) > 0;
  const hasRepo = repos.length > 0;
  return { ready, hasContext, hasRepo, done: ready && hasContext && hasRepo, signal };
}
