/**
 * View-mode state: which *slice* of a repo's data the user is looking
 * at, independent of the repo-loading / analyze / socket lifecycle
 * (that stays in RepoPage as the page controller).
 *
 *   - isDiffMode  — diff view toggle, mirrored to ?view=diff.
 *   - selectedAnalysisId — viewing a historical analysis (vs current).
 *   - selectedPath — graph path-filter highlight.
 *
 * Lifted out of RepoPage so these view selections aren't tangled up
 * with the data hooks; the page reads them here and passes them into
 * its data hooks / render.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export interface ViewModeContextValue {
  isDiffMode: boolean;
  /** Toggle diff mode; mirrors ?view=diff in the URL. */
  setIsDiffMode: (diff: boolean) => void;
  selectedAnalysisId: string | null;
  setSelectedAnalysisId: (id: string | null) => void;
  selectedPath: string | null;
  setSelectedPath: (path: string | null) => void;
}

const ViewModeContext = createContext<ViewModeContextValue | null>(null);

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [isDiffMode, setIsDiffModeState] = useState(
    () => searchParams?.get('view') === 'diff',
  );
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(
    null,
  );
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const setIsDiffMode = useCallback(
    (diff: boolean) => {
      setIsDiffModeState(diff);
      const url = new URL(window.location.href);
      if (diff) url.searchParams.set('view', 'diff');
      else url.searchParams.delete('view');
      navigate(url.pathname + url.search);
    },
    [navigate],
  );

  // Mirror ?view into state on Back/Forward + deep links.
  useEffect(() => {
    setIsDiffModeState(searchParams?.get('view') === 'diff');
  }, [searchParams]);

  const value = useMemo<ViewModeContextValue>(
    () => ({
      isDiffMode,
      setIsDiffMode,
      selectedAnalysisId,
      setSelectedAnalysisId,
      selectedPath,
      setSelectedPath,
    }),
    [isDiffMode, setIsDiffMode, selectedAnalysisId, selectedPath],
  );

  return (
    <ViewModeContext.Provider value={value}>
      {children}
    </ViewModeContext.Provider>
  );
}

export function useViewMode(): ViewModeContextValue {
  const ctx = useContext(ViewModeContext);
  if (!ctx) {
    throw new Error('useViewMode must be used inside <ViewModeProvider>');
  }
  return ctx;
}
