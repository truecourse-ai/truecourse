/**
 * The Dependencies tab's pure half: how a dependency is NAMED and PAINTED, and
 * how a search narrows the list.
 *
 * Two paints, one rule — the guard palette: green when the thing is there, BLUE
 * when it is a to-do somebody can clear (that is what `unprovided` and
 * `incomplete` are), grey when there is nothing to do. Amber and orange are not
 * guard colours anywhere, and a half-registered instance is not a warning: it is
 * a blocked run.
 *
 * The row's other word is its TYPE — what the thing IS, in the reader's language.
 * The engine's class taxonomy (`supplied` / `seedable` / `step-creatable`) is how
 * the ENGINE decides who obtains a dependency; it answers a question no reader of
 * this page asked, and it renders nowhere.
 */

import type { GuardDependencyRow, GuardDependencyState } from '@/types/guard-dependencies';

export interface GuardDependencyPaint {
  label: string;
  /** Dot colour for a STATE (the dot + word idiom); empty for a type label. */
  dot: string;
  hint: string;
}

/**
 * WHAT a dependency is, in human words, derived from the entry itself — the shape
 * a reader is being asked to register:
 *
 *   API service   an account for a third party the repo calls
 *   binary        an executable the machine must already have (the program spawns it)
 *   login         an authenticated config directory, copied into the sandbox HOME
 *   project       a real checkout the program operates ON
 *   credentials   the variables a program reads a secret from
 *
 * A dependency with nothing to register (a scenario creates it, or the runner
 * seeds it) is NOT one of these and wears no type at all — inventing a word for
 * "nothing to do here" is exactly what the class chip used to do.
 */
export function guardDependencyType(dependency: GuardDependencyRow): GuardDependencyPaint | null {
  // A spawned binary comes first: detection saw the program EXECUTE it, which is
  // a different demand from "hold an account" even when the vendor is the same.
  if (dependency.service?.detectedVia === 'binary') {
    return {
      label: 'Binary',
      dot: '',
      hint: 'The program spawns this as a subprocess, so the machine that runs the tests must already have it installed.',
    };
  }
  if (dependency.service) {
    return {
      label: 'API service',
      dot: '',
      hint: 'A third-party API the repo calls. Register the account guard should reach it with — the base URL, the token, and any headers it needs.',
    };
  }
  switch (dependency.registration?.kind) {
    case 'config-dir':
      return {
        label: 'Login',
        dot: '',
        hint: 'An authenticated state on this machine — a logged-in config directory. Guard copies it into the sandbox; it is never used in place.',
      };
    case 'path':
      return {
        label: 'Project',
        dot: '',
        hint: 'A real checkout the program operates on. Guard copies it into the sandbox, so a run can never mutate your working copy.',
      };
    case 'env':
      return {
        label: 'Credentials',
        dot: '',
        hint: 'The variables the program reads a credential from. Values are stored on this machine only and never committed.',
      };
    default:
      return null;
  }
}

/** Whether a supplied dependency can be bound on this machine, right now. */
export const GUARD_DEPENDENCY_STATE: Record<GuardDependencyState, GuardDependencyPaint> = {
  provided: {
    label: 'Provided',
    dot: 'bg-emerald-500',
    hint: 'An instance is registered and present — the flows that bind it run against it.',
  },
  incomplete: {
    label: 'Incomplete',
    dot: 'bg-sky-500',
    hint: 'Part of the registration is missing, so a run stops rather than test against half a world.',
  },
  unprovided: {
    label: 'Unprovided',
    dot: 'bg-sky-500',
    hint: 'Nothing is registered yet — the flows that bind it stay blocked until something is.',
  },
};

/**
 * The list's narrowing: the name, what it is, and EVERY service it stands for — a
 * folded service has no row of its own, so searching its name has to find the one
 * that absorbed it.
 */
export function guardDependencyMatches(dependency: GuardDependencyRow, query: string): boolean {
  const q = query.toLowerCase();
  return (
    dependency.name.toLowerCase().includes(q) ||
    dependency.summary.toLowerCase().includes(q) ||
    dependency.requirement.toLowerCase().includes(q) ||
    (dependency.service?.services ?? []).some((s) => s.toLowerCase().includes(q))
  );
}
