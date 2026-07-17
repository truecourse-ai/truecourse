/**
 * The empty-corpus notice for the guard CLI surfaces (#807). Reads the persisted
 * corpus.json and, when it exists but holds no kept docs, derives the flavor and
 * renders the ONE shared formatter (`@truecourse/shared`). Keeping this read in the
 * CLI layer is deliberate: the guard-runner engine (`runFailureMessage`) stays pure
 * and never reads the corpus.
 *
 * Returns `null` when there is no corpus at all OR the corpus holds at least one
 * doc — callers treat `null` as "no empty-corpus story to tell here".
 */
import { readCorpus } from "@truecourse/spec-consolidator";
import { deriveEmptyCorpus, formatEmptyCorpus, type EmptyCorpusFlavor } from "@truecourse/shared";

export interface EmptyCorpusNotice {
  flavor: EmptyCorpusFlavor;
  /** The single user-facing explanation (WARNING/INFO channel — the wording is neutral). */
  message: string;
}

export function emptyCorpusNotice(repoRoot: string): EmptyCorpusNotice | null {
  const corpus = readCorpus(repoRoot);
  if (!corpus) return null;
  const docsKept = corpus.docs.length;
  // Back-compat: a corpus written before the stats block falls back to kept + skipped.
  const docsScanned = corpus.stats?.docsScanned ?? docsKept + corpus.skippedDocs.length;
  const flavor = deriveEmptyCorpus({ docsScanned, docsKept });
  if (!flavor) return null;
  return {
    flavor,
    message: formatEmptyCorpus({
      flavor,
      docsScanned,
      ignoredNonMarkdown: corpus.stats?.ignoredNonMarkdown ?? {},
    }),
  };
}
