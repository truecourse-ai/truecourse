/**
 * URL-addressable Guard selection: `?guard=<docRef>` picks the coverage doc,
 * `?gsec=<anchor>` opens a section's detail, and `?gconf=<overlapKey>` opens a
 * spec-conflict's resolution detail. The doc-picker sidebar (the reused
 * SpecCorpusView) and the main coverage pane read/write through this hook, so the
 * URL is the single shared source and every doc / section / conflict is
 * deep-linkable. Writes merge into the existing query so sibling params are
 * preserved.
 *
 * These params are guard's OWN slice — BL Drift's Spec tab keys off `?spec=` and
 * the DriftViewContext, so acting in Guard never moves the BL-Drift spec view and
 * vice versa. The detail pane multiplexes on exactly one of `?gsec`/`?gconf`, so
 * selecting a section clears any open conflict and selecting a conflict clears any
 * open section.
 */

import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { parseSpecKey } from '@/components/spec/SpecCorpusView';

export interface GuardSelection {
  /** The selected coverage doc (`?guard`). */
  doc: string | null;
  /** The open section's anchor (`?gsec`). */
  section: string | null;
  /** The open spec-conflict's overlap key (`?gconf`). */
  conflict: string | null;
  selectDoc: (doc: string | null) => void;
  selectSection: (anchor: string | null) => void;
  selectConflict: (key: string | null) => void;
  /** SpecCorpusView `onOpen` adapter: route a doc ref / overlap key to the right param. */
  open: (key: string, pinned: boolean) => void;
  /** The SpecCorpusView `activeKey`: the open conflict's key, else the selected doc. */
  activeKey: string | null;
}

export function useGuardSelection(): GuardSelection {
  const [params, setParams] = useSearchParams();

  const selectDoc = useCallback(
    (doc: string | null) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (doc) next.set('guard', doc);
        else next.delete('guard');
        // Switching docs drops any section/conflict opened against the old one.
        next.delete('gsec');
        next.delete('gconf');
        return next;
      });
    },
    [setParams],
  );

  const selectSection = useCallback(
    (anchor: string | null) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (anchor) next.set('gsec', anchor);
        else next.delete('gsec');
        // The detail pane shows one thing — a section takes it over from a conflict.
        next.delete('gconf');
        return next;
      });
    },
    [setParams],
  );

  const selectConflict = useCallback(
    (key: string | null) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (key) next.set('gconf', key);
        else next.delete('gconf');
        // The detail pane shows one thing — a conflict takes it over from a section.
        next.delete('gsec');
        return next;
      });
    },
    [setParams],
  );

  const open = useCallback(
    (key: string, _pinned: boolean) => {
      // Guard has no tab bar, so the pinned flag is irrelevant here.
      const parsed = parseSpecKey(key);
      if (parsed.kind === 'overlap') selectConflict(key);
      else selectDoc(parsed.ref);
    },
    [selectConflict, selectDoc],
  );

  const conflict = params.get('gconf');
  const doc = params.get('guard');
  return {
    doc,
    section: params.get('gsec'),
    conflict,
    selectDoc,
    selectSection,
    selectConflict,
    open,
    activeKey: conflict ?? doc,
  };
}
