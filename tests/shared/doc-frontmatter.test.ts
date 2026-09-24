/**
 * The reader behind everything that states a document's own facts: the scan
 * briefings that weigh two documents against each other, and the document page
 * that shows a reader where a ticket stands.
 *
 * Its contract is tolerance. A document states whatever it states — a block it
 * does not have, a field it omits, a date nobody can parse — and the reader
 * answers with what it found and never throws.
 */

import { describe, it, expect } from 'vitest';
import { readDocFrontmatter } from '../../packages/shared/src/index.js';

/** The block a synced ticket opens with, exactly as the connector writes it. */
const TICKET = [
  '---',
  'created: 2026-01-10T09:00:00.000Z',
  'updated: 2026-03-02T15:20:00.000Z',
  'resolved: 2026-03-01T10:00:00.000Z',
  'status: "Done"',
  'status_category: "done"',
  'status_history:',
  '  - "… 3 earlier transitions omitted"',
  '  - "2026-02-01T10:00:00.000Z  To Do -> In Progress"',
  '  - "2026-03-01T10:00:00.000Z  In Progress -> Done"',
  '---',
  '',
  '# ENG-42: Orders can be cancelled before dispatch',
  '',
  'An order in Pending may be cancelled by its owner.',
].join('\n');

describe('readDocFrontmatter — what a ticket states about itself', () => {
  it('reads the dates, the status and its category', () => {
    const f = readDocFrontmatter(TICKET)!;
    expect(f.created).toBe('2026-01-10T09:00:00.000Z');
    expect(f.updated).toBe('2026-03-02T15:20:00.000Z');
    expect(f.resolved).toBe('2026-03-01T10:00:00.000Z');
    // The NAME verbatim — classifying it is somebody else's judgment.
    expect(f.status).toBe('Done');
    expect(f.statusCategory).toBe('done');
  });

  it('reads the history in order, and says how much of it was dropped', () => {
    const f = readDocFrontmatter(TICKET)!;
    expect(f.statusHistory).toEqual([
      { at: '2026-02-01T10:00:00.000Z', from: 'To Do', to: 'In Progress' },
      { at: '2026-03-01T10:00:00.000Z', from: 'In Progress', to: 'Done' },
    ]);
    expect(f.omittedTransitions).toBe(3);
  });

  it('keeps the first transition, whose `from` is nothing', () => {
    const f = readDocFrontmatter(
      ['---', 'status_history:', '  - "2026-01-01T00:00:00.000Z  (none) -> To Do"', '---'].join('\n'),
    )!;
    expect(f.statusHistory).toEqual([{ at: '2026-01-01T00:00:00.000Z', from: '(none)', to: 'To Do' }]);
  });

  it('takes a transition that states no instant', () => {
    const f = readDocFrontmatter(['---', 'status_history:', '  - "To Do -> Done"', '---'].join('\n'))!;
    expect(f.statusHistory).toEqual([{ from: 'To Do', to: 'Done' }]);
  });

  it('reads a Confluence page, which states dates and no status', () => {
    const f = readDocFrontmatter(
      ['---', 'created: 2026-02-02T08:00:00.000Z', 'updated: 2026-02-09T08:00:00.000Z', 'version: 7', '---', '', '# Billing'].join('\n'),
    )!;
    expect(f.updated).toBe('2026-02-09T08:00:00.000Z');
    expect(f.status).toBeUndefined();
    expect(f.statusHistory).toEqual([]);
    expect(f.omittedTransitions).toBe(0);
  });

  it('reads an author\'s own header, the shape a PRD writes', () => {
    const f = readDocFrontmatter(['---', 'title: Orders', 'Status: shipped', '---', '', '# Orders'].join('\n'))!;
    expect(f.status).toBe('shipped');
  });
});

describe('readDocFrontmatter — what it refuses to invent', () => {
  it('answers nothing for a document with no block', () => {
    expect(readDocFrontmatter('# Orders\n\nAn order may be cancelled.')).toBeUndefined();
  });

  it('does not take a horizontal rule for a block', () => {
    // No closing fence: prose that merely opens with a rule.
    expect(readDocFrontmatter(['---', '', '# Orders', '', 'body'].join('\n'))).toBeUndefined();
  });

  it('only reads a block that opens the document', () => {
    const late = ['intro', '', '---', 'status: "Done"', '---'].join('\n');
    expect(readDocFrontmatter(late)).toBeUndefined();
  });

  it('answers nothing for a block that states nothing it knows', () => {
    expect(readDocFrontmatter(['---', 'layout: page', 'tags: [a, b]', '---', '', '# X'].join('\n'))).toBeUndefined();
  });

  it('drops a date nobody can parse rather than inventing one', () => {
    const f = readDocFrontmatter(['---', 'created: someday', 'status: "Done"', '---'].join('\n'))!;
    expect(f.created).toBeUndefined();
    expect(f.status).toBe('Done');
  });

  it('normalizes a stated instant to ISO', () => {
    const f = readDocFrontmatter(['---', 'updated: 2026-03-02', '---'].join('\n'))!;
    expect(f.updated).toBe('2026-03-02T00:00:00.000Z');
  });

  it('unescapes the quoting a YAML writer applies', () => {
    const f = readDocFrontmatter(['---', 'status: "Won\\"t Do"', '---'].join('\n'))!;
    expect(f.status).toBe('Won"t Do');
  });

  it('lets the first statement of a field win', () => {
    // The history entries open with an instant, never a field name, precisely so
    // a transition cannot be read as the document's own date.
    const f = readDocFrontmatter(
      ['---', 'updated: 2026-03-02T15:20:00.000Z', 'updated: 2020-01-01T00:00:00.000Z', '---'].join('\n'),
    )!;
    expect(f.updated).toBe('2026-03-02T15:20:00.000Z');
  });

  it('never throws, whatever the block holds', () => {
    for (const body of ['---\n---\n', '---\n\n---\n', '---\nstatus:\n---', '---\nstatus_history:\n  - ""\n---']) {
      expect(() => readDocFrontmatter(body)).not.toThrow();
    }
  });
});
