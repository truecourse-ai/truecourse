/**
 * Versioned generated state. Every artifact a run produces — a repository's
 * scenario set, generate report and setup bundle, a workspace's corpus and its
 * document snapshot — is a SERIES: one version per producing run, never
 * overwritten. The current one is the newest of its series, and a series is
 * addressed by its SCOPE: the default branch (`default`), or a pull request's
 * own line of versions. Each version says which run produced it, on which
 * model, and when.
 */

/** The scope every read and write lands in when none is named. */
export const DEFAULT_VERSION_SCOPE = 'default';

/** What every stored version records about itself. */
export interface StoredVersion {
  id: string;
  scope: string;
  /** The session run that produced it (the Agent page's run id), when one did. */
  producedByRun: string | null;
  /** The model that run was on, when one was. */
  model: string | null;
  createdAt: string;
}

/** The three repository series. */
export type GuardVersionArtifact = 'scenarios' | 'report' | 'setup';

export interface GuardVersion extends StoredVersion {
  artifact: GuardVersionArtifact;
  /** The commit the version was produced at. */
  commitSha: string;
  /** Files in a scenario set or a setup bundle; null on a report. */
  fileCount: number | null;
}

/** The two workspace series. Decisions are a ledger people edit, not a series. */
export type WorkspaceSpecVersionArtifact = 'corpus' | 'docs';

export interface WorkspaceSpecVersion extends StoredVersion {
  artifact: WorkspaceSpecVersionArtifact;
  /** The commit a candidate corpus read its documents at; null on the default line. */
  sourceCommit: string | null;
}

/** One section of a document, as the guard manifest binds it. */
export interface VersionSectionRef {
  doc: string;
  anchor: string;
}

/**
 * What changed between two versions of a scenario set. A flow is LIVE in a
 * version when its manifest entry is present and not orphaned; retired means
 * it was live before and is not now.
 */
export interface ScenarioSetDiff {
  flows: {
    added: string[];
    retired: string[];
    /** Live on both sides with a different fingerprint or settle hash. `movedInputs`
     *  names the settle inputs that moved, or null when the prior recorded none. */
    amended: Array<{ flowId: string; movedInputs: string[] | null }>;
    kept: string[];
  };
  scenarios: { added: string[]; removed: string[] };
  /** A section is covered when a live flow with at least one scenario binds it. */
  sections: { gained: VersionSectionRef[]; lost: VersionSectionRef[] };
}

/** What changed between two versions of a workspace corpus. */
export interface CorpusDiff {
  docs: {
    added: string[];
    removed: string[];
    /** Kept on both sides under a different set of areas. */
    retagged: Array<{ ref: string; from: string[]; to: string[] }>;
  };
  areas: { added: string[]; removed: string[] };
  /** Overlap flags by document pair: pairs flagged only after, only before. */
  conflicts: { opened: number; closed: number };
}
