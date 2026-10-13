/**
 * A FLOW'S STEPS, AS THEY ARE QUOTED — each milestone of a flow with the claim
 * it names and the document text that claim was read from.
 *
 * The session that writes a flow's test and the judge that reads the test
 * afterwards are shown the same words, rendered here once: what the judge
 * holds a spec to is exactly what its author was given. A step's title is its
 * claim title, which is also what the spec's `test.step` for it is called.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readGuardClaimsCorpus } from '@truecourse/guard-runner';
import { claimsById, parseDocTree, sectionOfSentences, sectionOwnText, type Claim, type DocTree, type GuardFlow } from '@truecourse/shared';

/** How much of one document passage is quoted. */
const SECTION_QUOTE_CHARS = 4_000;

/** One step of a flow: the claim and the text it was read from. */
export interface FlowTestStep {
  order: number;
  claimTitle: string;
  /** The claim as the scan read it, when the claim corpus has it. */
  claim?: string;
  doc: string;
  /** The heading the claim's sentences sit under, when the document could be read. */
  heading?: string;
  /** The text of the section the claim's sentences sit in, when the document could be read. */
  sectionText?: string;
}

/** A step's passage as it is quoted: the whole of a short one, the start of a long one. */
export function quotedSection(step: FlowTestStep): string | undefined {
  const text = step.sectionText;
  if (text === undefined) return undefined;
  return text.length <= SECTION_QUOTE_CHARS
    ? text
    : `${text.slice(0, SECTION_QUOTE_CHARS)}\n… (${text.length - SECTION_QUOTE_CHARS} more characters in the document)`;
}

/** The steps as a briefing lists them: `<order>. <claim title>`, the claim, the document, the passage. */
export function flowStepQuotes(steps: readonly FlowTestStep[]): string[] {
  return steps.flatMap((step) => {
    const section = quotedSection(step);
    return [
      `${step.order}. ${step.claimTitle}`,
      ...(step.claim ? [`   claim: ${step.claim}`] : []),
      `   document: ${step.doc}${step.heading ? ` § ${step.heading}` : ''}`,
      ...(section ? ['   the passage, as written:', ...section.split('\n').map((line) => `   | ${line}`)] : []),
      '',
    ];
  });
}

/**
 * Reads a flow's steps out of a work tree: each milestone with the claim it
 * names and the section its sentences sit in. Documents are read once each,
 * however many flows cite them.
 */
export function flowStepReader(repoRoot: string): (flow: GuardFlow) => FlowTestStep[] {
  const claims: Map<string, Claim> = claimsById(readGuardClaimsCorpus(repoRoot)?.claims ?? []);
  const trees = new Map<string, DocTree | null>();
  const treeOf = (doc: string): DocTree | null => {
    let tree = trees.get(doc);
    if (tree === undefined) {
      try {
        tree = parseDocTree(doc, fs.readFileSync(path.resolve(repoRoot, doc), 'utf-8'));
      } catch {
        tree = null;
      }
      trees.set(doc, tree);
    }
    return tree;
  };
  return (flow) =>
    [...flow.milestones].sort((a, b) => a.order - b.order).map((milestone) => {
      const claim = claims.get(milestone.claimId);
      const tree = treeOf(milestone.doc);
      const section = tree ? sectionOfSentences(tree, milestone.sentences) : null;
      return {
        order: milestone.order,
        claimTitle: milestone.claimTitle,
        ...(claim ? { claim: claim.statement } : {}),
        doc: milestone.doc,
        ...(tree && section ? { heading: section.headingText, sectionText: sectionOwnText(tree, section) } : {}),
      };
    });
}
