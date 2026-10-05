/**
 * A FLOW'S STEPS, AS THEY ARE QUOTED — each milestone of a flow with the claim
 * it names and the document section that claim was read from.
 *
 * The session that writes a flow's test and the judge that reads the test
 * afterwards are shown the same words, rendered here once: what the judge
 * holds a spec to is exactly what its author was given. A step's title is its
 * claim title, which is also what the spec's `test.step` for it is called.
 */

import fs from 'node:fs';
import path from 'node:path';
import { extractSectionTexts, readGuardClaimsCorpus } from '@truecourse/guard-runner';
import type { GuardClaim, GuardFlow } from '@truecourse/shared';

/** How much of one document section is quoted. */
const SECTION_QUOTE_CHARS = 4_000;

/** One step of a flow: the claim and the text it was read from. */
export interface FlowTestStep {
  order: number;
  claimTitle: string;
  /** The claim as extracted, when the claim corpus has it. */
  claim?: string;
  doc: string;
  anchor: string;
  /** The section the claim lives in, when the document could be read. */
  sectionText?: string;
}

/** A step's section as it is quoted: the whole of a short one, the start of a long one. */
export function quotedSection(step: FlowTestStep): string | undefined {
  const text = step.sectionText;
  if (text === undefined) return undefined;
  return text.length <= SECTION_QUOTE_CHARS
    ? text
    : `${text.slice(0, SECTION_QUOTE_CHARS)}\n… (${text.length - SECTION_QUOTE_CHARS} more characters in the document)`;
}

/** The steps as a briefing lists them: `<order>. <claim title>`, the claim, the document, the section. */
export function flowStepQuotes(steps: readonly FlowTestStep[]): string[] {
  return steps.flatMap((step) => {
    const section = quotedSection(step);
    return [
      `${step.order}. ${step.claimTitle}`,
      ...(step.claim ? [`   claim: ${step.claim}`] : []),
      `   document: ${step.doc} § ${step.anchor}`,
      ...(section ? ['   the section, as written:', ...section.split('\n').map((line) => `   | ${line}`)] : []),
      '',
    ];
  });
}

/**
 * Reads a flow's steps out of a work tree: each milestone with the claim it
 * names and the section that claim was read from. Documents are read once
 * each, however many flows cite them.
 */
export function flowStepReader(repoRoot: string): (flow: GuardFlow) => FlowTestStep[] {
  const claims = new Map<string, GuardClaim>();
  for (const claim of readGuardClaimsCorpus(repoRoot)?.claims ?? []) {
    claims.set(claimKey(claim.doc, claim.anchor, claim.title), claim);
  }
  const sections = new Map<string, ReturnType<typeof extractSectionTexts> | null>();
  const sectionsOf = (doc: string): ReturnType<typeof extractSectionTexts> | null => {
    let texts = sections.get(doc);
    if (texts === undefined) {
      try {
        texts = extractSectionTexts(doc, fs.readFileSync(path.resolve(repoRoot, doc), 'utf-8'));
      } catch {
        texts = null;
      }
      sections.set(doc, texts);
    }
    return texts;
  };
  return (flow) =>
    [...flow.milestones].sort((a, b) => a.order - b.order).map((milestone) => {
      const claim = claims.get(claimKey(milestone.doc, milestone.anchor, milestone.claimTitle));
      const section = sectionsOf(milestone.doc)?.get(milestone.anchor);
      return {
        order: milestone.order,
        claimTitle: milestone.claimTitle,
        ...(claim ? { claim: claim.claim } : {}),
        doc: milestone.doc,
        anchor: milestone.anchor,
        ...(section ? { sectionText: section.ownText } : {}),
      };
    });
}

function claimKey(doc: string, anchor: string, title: string): string {
  return `${doc}\0${anchor}\0${title}`;
}
