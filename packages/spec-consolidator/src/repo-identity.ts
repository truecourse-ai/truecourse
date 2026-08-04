/**
 * Repo self-identity — the answer to "which product is THIS repository's?".
 *
 * The relevance classifier is told to SKIP docs about a "THIRD-PARTY / external
 * system", but it was never told who we are: it saw only a path, a kind, a size
 * and a 60-line preview. So it had to infer "who are we" from the document
 * alone, and every decent API reference names its own product — which reads
 * exactly like a vendor's. Measured on calcom/cal.com, the entire v2 API
 * reference was dropped as "vendor API research (Cal.com's authentication
 * API)"; on wekan/wekan, 117 of 221 dropped docs cited third-party reasoning.
 * The selectivity is perverse: terse endpoint tables survive precisely because
 * they never name the product, so the better a doc reads the likelier it was
 * discarded.
 *
 * This module resolves the repo's own name, aliases and a short PRODUCT
 * DESCRIPTION so they can be stated to the classifier (an IDENTITY block in the
 * user prompt) and used as a deterministic backstop when the model gets it wrong
 * anyway.
 *
 * The description is what makes attribution possible for a doc that names NO
 * product: names alone answer "is this doc about cal.com?", but only "what the
 * product is" answers "is this doc about the same KIND of system we are?". It is
 * read deterministically — manifest `description` fields, then the README's
 * tagline — never inferred by an LLM.
 *
 * Split in two on purpose:
 *   - {@link readRepoIdentityInput} — the filesystem half. OSS only; EE's scan
 *     runs on an ephemeral shallow clone in a temp dir where the basename is
 *     `tc-gate-scan-XXXX` and there is nothing worth reading.
 *   - {@link resolveRepoIdentity} — pure. EE calls it directly with the
 *     authoritative `repoFullName` it already has, and it unit-tests without
 *     fixture repos.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse as parseToml } from 'smol-toml';
import { hasMarkdownExtension } from '@truecourse/shared';
import { docBody, type DocCandidate } from './discovery.js';

export interface RepoIdentityInput {
  /** EE: `req.repoFullName` (`owner/repo`). Authoritative — skips the fs entirely. */
  repoFullName?: string;
  /** `origin`'s URL, ssh or https. */
  gitRemoteUrl?: string;
  packageJson?: { name?: string; description?: string };
  /** Names from non-JS manifests: pyproject / Cargo / composer / go.mod. */
  manifestNames?: string[];
  /** `description` fields from the non-JS manifests, in descending authority. */
  manifestDescriptions?: string[];
  /**
   * The README's first H1, when the caller has it instead of the full text.
   * Otherwise it is read out of {@link RepoIdentityInput.readmeText}.
   */
  readmeH1?: string;
  /** The README's raw text — the product tagline is read out of it. */
  readmeText?: string;
  /** Weakest seed — used only when nothing better identifies the repo. */
  dirBasename?: string;
  /** Discovered docs, for corpus name-frequency expansion. */
  docs?: DocCandidate[];
}

export interface RepoIdentity {
  /** The best single name for the repo's product. */
  name: string;
  /**
   * What the product IS, in one bounded line — a manifest `description` or the
   * README's tagline. Absent when no source offered one.
   */
  description?: string;
  /** Names that may be MATCHED against doc text. Never shorter than {@link MIN_MATCHABLE_ALIAS}. */
  aliases: string[];
  /** Which seeds contributed, for debuggability. */
  sources: string[];
}

/**
 * An alias below this length is not matchable. Splitting `cal.com` yields `cal`
 * — a real English word and a substring of hundreds of unrelated tokens. Used
 * as a matchable alias it would turn the third-party backstop into a
 * re-include-everything switch. Short cores may still ANCHOR corpus expansion
 * (see `cores` below); they just never reach the prompt or the matcher.
 */
export const MIN_MATCHABLE_ALIAS = 4;

/**
 * Cap on aliases reaching the prompt. Bounded so a corpus-derived tail can't
 * churn the identity fingerprint (and re-spend the whole relevance cache) every
 * time a doc is added.
 */
export const MAX_ALIASES = 6;

/**
 * Cap on the product description reaching the prompt. A README's opening
 * paragraph can run long; the classifier needs "what kind of system is this",
 * not the pitch.
 */
export const MAX_DESCRIPTION_CHARS = 400;

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

interface Seed {
  value: string;
  source: string;
}

/** Separators inside a product name: `cal.com`, `next-auth`, `my_app`. */
const NAME_SEPARATORS = /[./\-_ ]+/;

/**
 * Resolve the repo's identity from whatever seeds are available. Returns null
 * when nothing identifies the repo — callers must treat that as "no identity
 * block", never as an empty-alias identity (an empty alias set would make the
 * backstop match nothing while still perturbing the cache key).
 */
export function resolveRepoIdentity(input: RepoIdentityInput): RepoIdentity | null {
  const seeds = collectSeeds(input);
  if (seeds.length === 0) return null;

  const cores = new Set<string>();
  for (const seed of seeds) for (const core of coresOf(seed.value)) cores.add(core);
  // A TLD is not a product stem. `cal.com` contributes the core `com`, and
  // anchoring on it would admit `Stripe.com`, `Google.com` and every other
  // vendor domain in the corpus.
  for (const tld of GENERIC_DOMAIN_CORES) cores.delete(tld);

  const expanded = input.docs?.length ? expandAliasesFromCorpus(input.docs, cores) : [];
  const aliases = dedupeAliases([...seeds.map((s) => s.value), ...expanded]).filter(
    (a) => a.length >= MIN_MATCHABLE_ALIAS,
  );

  return {
    name: seeds[0].value,
    description: resolveDescription(input),
    aliases: aliases.slice(0, MAX_ALIASES),
    sources: [...new Set(seeds.map((s) => s.source))],
  };
}

/**
 * What the product IS, from the first source that offers a usable line:
 * package.json, then the non-JS manifests, then the README's tagline. Every
 * source is optional and every one degrades to `undefined` rather than throwing
 * — a repo with no manifest description and a badge-only README simply resolves
 * to name + aliases, exactly as before this existed.
 */
function resolveDescription(input: RepoIdentityInput): string | undefined {
  const candidates = [
    input.packageJson?.description,
    ...(input.manifestDescriptions ?? []),
    taglineFromReadme(input.readmeText),
  ];
  for (const candidate of candidates) {
    const description = boundedDescription(candidate);
    if (description) return description;
  }
  return undefined;
}

/** A description candidate reduced to prose, bounded, or undefined when empty. */
function boundedDescription(raw: string | undefined): string | undefined {
  const text = plainProse(raw ?? '');
  if (!text) return undefined;
  if (text.length <= MAX_DESCRIPTION_CHARS) return text;
  return `${text.slice(0, MAX_DESCRIPTION_CHARS).replace(/\s+\S*$/, '')}…`;
}

/** How far into a README the tagline may sit before we stop looking. */
const README_SCAN_LINES = 60;

/**
 * The README's product tagline: the H1 when it reads like a sentence rather than
 * a title, otherwise the first paragraph that survives decoration stripping.
 *
 * READMEs open with logos, shields and centered HTML, so "first paragraph" has
 * to mean "first paragraph with prose left in it after the markup is gone" —
 * `stripForNames` already defines exactly that reduction, and reusing it is what
 * keeps badge blocks, `<p align="center">` wrappers and link rows from becoming
 * the product description. List and table paragraphs are skipped too: a feature
 * bullet list says what the product HAS, not what it IS.
 */
export function taglineFromReadme(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const lines = unfencedLines(text).slice(0, README_SCAN_LINES);

  let start = 0;
  const h1At = lines.findIndex((l) => /^#\s+\S/.test(l));
  if (h1At >= 0 && h1IsDocumentTitle(lines, h1At)) {
    // A title-shaped H1 is the product NAME (already a seed); a sentence-shaped
    // one IS the tagline ("# Foo — scheduling for teams").
    const h1 = plainProse(lines[h1At].replace(/^#\s+/, ''));
    if (h1 && h1.split(/\s+/).length > MAX_README_H1_WORDS) return h1;
    start = h1At + 1;
  }
  // A NON-title first H1 is a section heading (`# Install` after a logo +
  // tagline): the product's own line sits ABOVE it, so the scan starts at the
  // top and the paragraph loop's heading-break keeps section bodies out.

  let para: string[] = [];
  for (let i = start; i <= lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() !== '' && !/^#{1,6}\s/.test(line)) {
      para.push(line);
      continue;
    }
    const prose = isListing(para) ? '' : plainProse(para.join('\n'));
    para = [];
    if (isProse(prose)) return prose;
  }
  return undefined;
}

/**
 * README lines with fenced regions blanked out. Load-bearing for both
 * README-derived seeds: a quickstart block opening with `# Install` is a SHELL
 * COMMENT, and reading it as the document's H1 hands the repo a title and a
 * tagline out of someone's copy-paste snippet.
 */
function unfencedLines(text: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      out.push('');
      continue;
    }
    out.push(inFence ? '' : line);
  }
  return out;
}

/** Is every line of this paragraph a list item or table row? */
function isListing(lines: string[]): boolean {
  return lines.length > 0 && lines.every((l) => /^\s*([-*+]\s|\d+[.)]\s|\|)/.test(l));
}

/** Enough words, with letters in them, to be a description rather than a remnant. */
function isProse(text: string): boolean {
  return /[A-Za-z]/.test(text) && text.split(/\s+/).length >= 2;
}

/** Markdown/HTML decoration removed, whitespace collapsed. */
function plainProse(text: string): string {
  return stripForNames(text)
    .replace(/^\s*[>#]+\s*/gm, '') // blockquote / heading markers
    .replace(/^\s*([-*+]|\d+[.)])\s+/gm, '') // list bullets
    .replace(/\*\*?|__/g, '') // emphasis
    .replace(/\s+/g, ' ')
    .trim();
}

/** Domain suffixes that name a registry, not a product. */
const GENERIC_DOMAIN_CORES = new Set([
  'com', 'io', 'org', 'net', 'dev', 'app', 'co', 'ai', 'sh', 'xyz', 'inc', 'git', 'github',
]);

// ---------------------------------------------------------------------------
// Corpus name expansion
// ---------------------------------------------------------------------------

/** A term must appear in at least this many docs — a floor against typos. */
const MIN_ALIAS_DOCS = 3;
/** …and at least this share of them, so the floor scales with a large corpus. */
const MIN_ALIAS_DOC_FRACTION = 0.03;

/**
 * Proper-noun-shaped tokens. The `[.\-]` tail is what captures the names that
 * matter — `Cal.com`, `Cal.diy`, `Next.js` — rather than stopping at `Cal`.
 */
const PROPER_NOUN = /\b[A-Z][a-zA-Z0-9]*(?:[.\-][A-Za-z0-9]+)*/g;

/**
 * Names the repo calls itself that no manifest records. cal.com's own brand
 * appears in its docs as `Cal.diy` (23%), `Cal.com` (18%) and `calcom` (12%) —
 * the git remote knows only the last.
 *
 * Admission is SEED-ANCHORED, never threshold-based, and the measured
 * frequencies are what rule thresholds out: cal.com's brand sits at 23% while
 * Trello sits at 9% in wekan's docs, so no cutoff separates them; and because
 * cal.com's brand is split three ways, "take the top term" fails too. A term is
 * admitted only when one of its core stems matches a metadata seed's — which is
 * why `Cal.diy` is recovered (it shares `cal` with the remote) and why `Google`,
 * `Stripe` and `Trello` are rejected categorically rather than by rank.
 *
 * Frequency then serves exactly one narrow job: a floor against typos.
 *
 * Known cost, worth stating: corpus-derived aliases are input-dependent, so in
 * principle adding one document could shift the alias set and invalidate every
 * cached verdict. Seed-anchoring, the cap, and hashing only the rendered aliases
 * are what keep tail churn out of the fingerprint.
 */
function expandAliasesFromCorpus(docs: DocCandidate[], seedCores: Set<string>): string[] {
  const docFreq = new Map<string, number>();
  const display = new Map<string, string>();
  // A token seen only at the start of a sentence or heading is almost always an
  // ordinary capitalized word (`The`, `When`, `Users`). Requiring one
  // mid-sentence sighting SOMEWHERE in the corpus is the highest-value filter
  // here, and it replaces a large stopword list.
  const midSentence = new Set<string>();

  for (const doc of docs) {
    const seenHere = new Set<string>();
    for (const line of stripForNames(docBody(doc)).split(/\r?\n/)) {
      for (const match of line.matchAll(PROPER_NOUN)) {
        const term = match[0].replace(/[.\-]+$/, ''); // trailing sentence punctuation
        if (term.length < MIN_MATCHABLE_ALIAS) continue;
        const key = term.toLowerCase();
        seenHere.add(key);
        if (!display.has(key)) display.set(key, term);
        if (!isInitial(line.slice(0, match.index))) midSentence.add(key);
      }
    }
    // DOCUMENT frequency, not term frequency: a doc saying "Stripe" 200 times
    // counts once. Term frequency would rank Stripe far above Cal.diy.
    for (const key of seenHere) docFreq.set(key, (docFreq.get(key) ?? 0) + 1);
  }

  const floor = Math.max(MIN_ALIAS_DOCS, Math.ceil(docs.length * MIN_ALIAS_DOC_FRACTION));
  return [...docFreq]
    .filter(([key, n]) => {
      if (n < floor || !midSentence.has(key)) return false;
      return coresOf(key).some((core) => seedCores.has(core));
    })
    // Frequency first, then lexicographic. Ties are common, and a
    // nondeterministic sort would churn the identity fingerprint — which re-keys
    // every cached relevance verdict in the repo.
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, MAX_ALIASES)
    .map(([key]) => display.get(key)!);
}

/** Is this position the start of a sentence, heading, or list item? */
function isInitial(prefix: string): boolean {
  const trimmed = prefix.trimEnd();
  if (trimmed.length === 0) return true;
  return '.!?#>*|:;'.includes(trimmed[trimmed.length - 1]);
}

function collectSeeds(input: RepoIdentityInput): Seed[] {
  const seeds: Seed[] = [];
  const push = (value: string | undefined, source: string): void => {
    const v = value?.trim();
    if (v) seeds.push({ value: v, source });
  };

  // `owner/repo` — EE hands this over directly and it is authoritative.
  if (input.repoFullName) push(repoPart(input.repoFullName), 'repo-full-name');
  else push(repoFromRemote(input.gitRemoteUrl), 'git-remote');

  push(stripScope(input.packageJson?.name), 'package.json');
  for (const name of input.manifestNames ?? []) push(stripScope(name), 'manifest');
  push(titleFromH1(input.readmeH1 ?? firstH1(input.readmeText)), 'readme-h1');

  // The weakest seed: a directory basename is often a checkout name
  // (`cal.com-fork`) or a scratch temp dir. Only consulted when nothing better
  // named the repo.
  if (seeds.length === 0) push(input.dirBasename, 'dir-basename');
  return seeds;
}

/**
 * A README H1 reduced to a product TITLE, or undefined when it isn't one.
 * READMEs decorate their H1 with badges and logo links, and plenty open with a
 * sentence ("Welcome to the Wekan developer documentation wiki") that would
 * otherwise become a junk alias — so decoration is stripped and anything past a
 * few words is rejected. Lives here rather than in the fs reader so EE gets the
 * same treatment when it supplies an H1 directly.
 */
const MAX_README_H1_WORDS = 3;

/** The README's first H1, raw — fenced code blocks excluded (see `unfencedLines`). */

/**
 * Is the H1 at `h1At` the DOCUMENT's title — or a section heading? Structural
 * rule, no heading-word lists: a title has nothing but decoration above it
 * (logo images, badge rows, centered HTML); a section heading follows prose.
 * TrueCourse's own README is the measured case: logo + bold tagline, then
 * `# Install` — reading "Install" as the product name handed the classifier a
 * garbage identity.
 */
function h1IsDocumentTitle(lines: string[], h1At: number): boolean {
  for (let i = 0; i < h1At; i++) {
    if (isProse(plainProse(lines[i]))) return false;
  }
  return true;
}

function firstH1(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const lines = unfencedLines(text);
  const h1At = lines.findIndex((l) => /^#\s+\S/.test(l));
  if (h1At < 0) return undefined;
  if (!h1IsDocumentTitle(lines, h1At)) return undefined;
  return lines[h1At].replace(/^#\s+/, '');
}

function titleFromH1(h1: string | undefined): string | undefined {
  if (!h1) return undefined;
  const title = h1
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images (incl. badges)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → their text
    .replace(/[*_`]/g, '')
    .trim();
  if (!title) return undefined;
  return title.split(/\s+/).length <= MAX_README_H1_WORDS ? title : undefined;
}

/** The repo half of `owner/repo`. */
function repoPart(fullName: string): string {
  const parts = fullName.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

/**
 * `org/repo` out of a git remote URL — ssh (`git@host:org/repo.git`), https
 * (`https://host/org/repo.git`) or a local path. Nothing in the codebase parsed
 * remotes before this.
 */
export function repoFromRemote(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim().replace(/\.git$/i, '').replace(/\/+$/, '');
  if (!trimmed) return undefined;
  const afterHost = trimmed.includes(':') ? trimmed.slice(trimmed.lastIndexOf(':') + 1) : trimmed;
  const name = repoPart(afterHost);
  return name || undefined;
}

/** `@calcom/web` → `web`. An npm scope names the org, not the product. */
function stripScope(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return name.startsWith('@') ? name.slice(name.indexOf('/') + 1) : name;
}

/**
 * The internal stem set used to ANCHOR corpus expansion. Lowercased, split on
 * name separators, plus the whole joined form — so `cal.com` contributes `cal`,
 * `com` and `calcom`, and a corpus term like `Cal.diy` can be recognised as
 * ours by its `cal` stem without `cal` ever becoming matchable.
 */
export function coresOf(value: string): string[] {
  const lower = value.toLowerCase();
  const parts = lower.split(NAME_SEPARATORS).filter(Boolean);
  return [...new Set([...parts, parts.join('')])].filter(Boolean);
}

/**
 * Collapse aliases that name the same thing: case and separators don't
 * distinguish `Cal.com` from `calcom` (the matcher already treats a separator in
 * an alias as optional). Order is preserved (seeds stay ahead of corpus terms),
 * but the DISPLAY spelling of each survivor is upgraded to the branded form —
 * the git remote yields lowercase `wekan`/`cal.com`, while the docs write
 * `Wekan`/`Cal.com`, and the branded spelling is what should reach the prompt.
 */
function dedupeAliases(values: string[]): string[] {
  const index = new Map<string, number>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase().replace(new RegExp(NAME_SEPARATORS, 'g'), '');
    if (!key) continue;
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, out.length);
      out.push(v);
    } else if (brandScore(v) > brandScore(out[at])) {
      out[at] = v; // same name, richer spelling — upgrade the display form
    }
  }
  return out;
}

/** Prefer a spelling that carries capitals and separators (`Cal.com` > `calcom`). */
function brandScore(v: string): number {
  const caps = (v.match(/[A-Z]/g) ?? []).length;
  const seps = (v.match(/[./\-_]/g) ?? []).length;
  return caps + seps;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** Regex-escape everything but the separators we rebuild ourselves. */
function escapeLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A case-insensitive matcher for "does this text name our product?".
 *
 * Two details carry the weight:
 *  - Custom lookarounds instead of `\b`. `\b` is defined on word characters, so
 *    it sits between `l` and `.` inside `cal.com` — `\bcal\.com\b` would match
 *    inside `xcal.comy`. `(?<![A-Za-z0-9])`/`(?![A-Za-z0-9])` mean what we
 *    actually want: not glued to an adjacent alphanumeric.
 *  - A separator is optional only where the alias already HAS one, so `cal.com`
 *    also matches `calcom` and `cal-com` — but `wekan` never matches `we-kan`.
 *    Allowing an inserted separator anywhere would match far too much.
 *
 * Not a global regex on purpose: a `/g` regex carries `lastIndex` between
 * `.test()` calls, and this one is built once and reused across every doc.
 */
export function aliasMatcher(aliases: string[]): RegExp {
  const parts = aliases
    .filter((a) => a.trim().length >= MIN_MATCHABLE_ALIAS)
    .sort((a, b) => b.length - a.length)
    .map((alias) => {
      const segments = alias.trim().split(NAME_SEPARATORS).filter(Boolean);
      return segments.length > 1
        ? segments.map(escapeLiteral).join('[.\\-_ ]?')
        : escapeLiteral(alias.trim());
    });
  // No aliases ⇒ a regex that can never match (rather than an empty alternation,
  // which matches the empty string everywhere).
  if (parts.length === 0) return /(?!)/;
  return new RegExp(`(?<![A-Za-z0-9])(?:${parts.join('|')})(?![A-Za-z0-9])`, 'i');
}

// ---------------------------------------------------------------------------
// Body stripping — the text a NAME may legitimately be read out of
// ---------------------------------------------------------------------------

/**
 * A doc reduced to its prose: code, markup and machine identifiers removed.
 * Used both by corpus name expansion and by the third-party backstop, and it is
 * the same requirement in both directions — a name that appears only inside
 * code or markup is not evidence about whose product the doc DESCRIBES.
 *
 * What comes out, and why each one bites:
 *  - **Fenced blocks and inline code.** `import { x } from '@calcom/lib'` in a
 *    Stripe integration doc would otherwise re-include it as ours.
 *  - **Link targets and URLs, keeping link text.** The sneakiest false
 *    positive: `[the guide](https://docs.google.com/…)` makes Google a frequent
 *    proper noun in any repo that links a shared doc.
 *  - **HTML and JSX tags with their attributes.** `.mdx` is discovered now, and
 *    `<ResponseField name="…" type="…">`, `<Accordion>`, `<Card>` are
 *    capitalized tokens sitting all over exactly the API-reference trees this
 *    fix exists to rescue. (Discovery deliberately keeps JSX as *content* for
 *    chunking — component attributes carry real field names. That is right for
 *    chunking and wrong for reading product names, so it is stripped here and
 *    only here.)
 *  - **Pure-markup lines**, via the same shape the near-duplicate detector uses.
 */
export function stripForNames(text: string): string {
  const stripped = text
    .replace(/```[\s\S]*?```/g, ' ') // fenced blocks
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ') // inline code spans
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images, alt text and all
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → their text only
    .replace(/<\/?[A-Za-z][^>]*>/g, ' ') // HTML + JSX tags (and `<autolinks>`)
    .replace(/\bhttps?:\/\/\S+/gi, ' ') // bare URLs
    .replace(/\bwww\.\S+/gi, ' ');

  return stripped
    .split(/\r?\n/)
    .filter((line) => {
      const l = line.trim();
      return l.length > 0 && !/^[#>*\-=|`_~ ]+$/.test(l);
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Prompt rendering + fingerprint
// ---------------------------------------------------------------------------

/**
 * Exactly the identity data that reaches the prompt, canonicalized: lowercased,
 * aliases sorted and capped. Sorting is what keeps the fingerprint independent
 * of doc-discovery order — corpus-derived aliases arrive in whatever order the
 * walk found them, and an order-sensitive hash would re-key every cached
 * relevance verdict whenever an unrelated doc was added.
 *
 * The description is in here because it is rendered into the block and the model
 * attributes against it: editing the README tagline or a manifest description
 * changes what the classifier is told the product IS, so every doc re-judges
 * once. That is the contract, not an accident.
 */
function canonicalIdentity(id: RepoIdentity): string {
  const aliases = [...new Set(id.aliases.map((a) => a.toLowerCase()))].sort().slice(0, MAX_ALIASES);
  return JSON.stringify({
    name: id.name.toLowerCase(),
    description: id.description?.toLowerCase() ?? '',
    aliases,
  });
}

/**
 * Fingerprint of the identity block's SUBJECT — orthogonal to the relevance
 * prompt's own fingerprint, which covers its INSTRUCTIONS. Two hashes rather
 * than one over the effective prompt, so a cache miss says which of the two
 * changed.
 */
export function identityFingerprint(id: RepoIdentity | null): string {
  const payload = id === null ? 'none' : canonicalIdentity(id);
  return createHash('sha256').update(`identity::${payload}`).digest('hex').slice(0, 16);
}

/**
 * The prompt text stating who we are — the thing the classifier attributes every
 * document AGAINST. Empty string when there's no identity: the user prompt is
 * then byte-identical to what it was before this existed, and the classifier
 * falls back to judging content alone.
 */
export function identityBlock(id: RepoIdentity | null): string {
  if (id === null) return '';
  const aliases = id.aliases.slice(0, MAX_ALIASES);
  const lines = [
    '--- IDENTITY: the repository being scanned ---',
    `This repository IS the product: ${id.name}`,
  ];
  if (id.description) lines.push(`What it is: ${id.description}`);
  if (aliases.length > 0) lines.push(`Also written as: ${aliases.join(', ')}`);
  lines.push(
    'Attribute every document against this. A doc describing THIS product — its API,',
    'UI, data, or behavior — is OURS, however much it reads like public vendor',
    'documentation. A doc describing any OTHER product is not ours.',
    '--- end identity ---',
    '',
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Filesystem half (OSS)
// ---------------------------------------------------------------------------

/**
 * Gather identity seeds from a checkout. Every read is best-effort: a repo with
 * no manifest, no remote and no README still resolves via its directory name.
 *
 * Reads `.git/config` directly rather than shelling out or going through core's
 * `getGit` — the consolidator is a leaf package (core depends on IT), so
 * importing core would be circular, and the remote URL is one well-defined line
 * of ini.
 */
export function readRepoIdentityInput(repoRoot: string): RepoIdentityInput {
  return {
    gitRemoteUrl: readGitRemoteUrl(repoRoot),
    packageJson: readPackageJson(repoRoot),
    manifestNames: readManifestNames(repoRoot),
    manifestDescriptions: readManifestDescriptions(repoRoot),
    readmeText: readReadmeText(repoRoot),
    dirBasename: path.basename(path.resolve(repoRoot)),
  };
}

/** `origin`'s fetch URL from `.git/config`, or any remote when there's no origin. */
function readGitRemoteUrl(repoRoot: string): string | undefined {
  let ini: string;
  try {
    ini = fs.readFileSync(path.join(repoRoot, '.git', 'config'), 'utf-8');
  } catch {
    return undefined;
  }
  const remotes = new Map<string, string>();
  let current: string | null = null;
  for (const raw of ini.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[remote\s+"([^"]+)"\]$/.exec(line);
    if (header) {
      current = header[1];
      continue;
    }
    if (line.startsWith('[')) {
      current = null;
      continue;
    }
    const url = current && /^url\s*=\s*(.+)$/.exec(line);
    if (url) remotes.set(current!, url[1].trim());
  }
  return remotes.get('origin') ?? [...remotes.values()][0];
}

function readPackageJson(repoRoot: string): { name?: string; description?: string } | undefined {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
    const name = typeof pkg.name === 'string' ? pkg.name : undefined;
    const description = typeof pkg.description === 'string' ? pkg.description : undefined;
    if (!name && !description) return undefined;
    return { name, description };
  } catch {
    return undefined;
  }
}

/** Project names from the non-JS manifests, in descending authority. */
function readManifestNames(repoRoot: string): string[] {
  const out: string[] = [];
  const push = (v: unknown): void => {
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
  };

  push(tomlValue(repoRoot, 'pyproject.toml', ['project', 'name']));
  push(tomlValue(repoRoot, 'pyproject.toml', ['tool', 'poetry', 'name']));
  push(tomlValue(repoRoot, 'Cargo.toml', ['package', 'name']));

  try {
    const composer = JSON.parse(fs.readFileSync(path.join(repoRoot, 'composer.json'), 'utf-8'));
    push(typeof composer.name === 'string' ? stripScope(composer.name) : undefined);
  } catch {
    /* no composer.json */
  }

  try {
    const mod = fs.readFileSync(path.join(repoRoot, 'go.mod'), 'utf-8');
    // `module github.com/org/thing` — the last path segment is the product.
    const m = /^module\s+(\S+)/m.exec(mod);
    if (m) push(repoPart(m[1]));
  } catch {
    /* no go.mod */
  }

  return out;
}

/** Project descriptions from the non-JS manifests, in descending authority. */
function readManifestDescriptions(repoRoot: string): string[] {
  const out: string[] = [];
  const push = (v: unknown): void => {
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
  };

  push(tomlValue(repoRoot, 'pyproject.toml', ['project', 'description']));
  push(tomlValue(repoRoot, 'pyproject.toml', ['tool', 'poetry', 'description']));
  push(tomlValue(repoRoot, 'Cargo.toml', ['package', 'description']));

  try {
    const composer = JSON.parse(fs.readFileSync(path.join(repoRoot, 'composer.json'), 'utf-8'));
    push(composer.description);
  } catch {
    /* no composer.json */
  }

  return out;
}

function tomlValue(repoRoot: string, file: string, keyPath: string[]): unknown {
  try {
    const parsed: unknown = parseToml(fs.readFileSync(path.join(repoRoot, file), 'utf-8'));
    let node: unknown = parsed;
    for (const key of keyPath) {
      if (typeof node !== 'object' || node === null) return undefined;
      node = (node as Record<string, unknown>)[key];
    }
    return node;
  } catch {
    return undefined;
  }
}

/**
 * The README's raw text. Both README-derived seeds are read out of it by the
 * pure half — the title (`titleFromH1`) and the product tagline
 * (`taglineFromReadme`) — so EE gets the same treatment when it supplies the
 * text directly.
 */
function readReadmeText(repoRoot: string): string | undefined {
  let entries: string[];
  try {
    entries = fs.readdirSync(repoRoot);
  } catch {
    return undefined;
  }
  const readme = entries.find((e) => /^readme/i.test(e) && hasMarkdownExtension(e));
  if (!readme) return undefined;
  try {
    return fs.readFileSync(path.join(repoRoot, readme), 'utf-8');
  } catch {
    return undefined;
  }
}
