import { describe, it, expect } from 'vitest';
import {
  SCAN_MARKER,
  renderScanComment,
  isScanComment,
  isScanCheckboxChecked,
} from '../../ee/packages/github-app/src/index';

describe('scan comment rendering', () => {
  it('every state carries the hidden marker', () => {
    for (const s of ['offered', 'running', 'done', 'nochange', 'error'] as const) {
      expect(renderScanComment(s, { error: 'x' })).toContain(SCAN_MARKER);
      expect(isScanComment(renderScanComment(s))).toBe(true);
    }
  });

  it('offered lists the changed spec docs and an unchecked box', () => {
    const body = renderScanComment('offered', { specDocs: ['docs/spec.md'] });
    expect(body).toContain('docs/spec.md');
    expect(body).toMatch(/- \[ \] Run TrueCourse scan/);
    expect(isScanCheckboxChecked(body)).toBe(false);
  });

  it('running and done have no checkbox to re-trigger', () => {
    expect(isScanCheckboxChecked(renderScanComment('running'))).toBe(false);
    expect(
      isScanCheckboxChecked(
        renderScanComment('done', { savedFileCount: 1, commitSha: 'abcdef123' }),
      ),
    ).toBe(false);
  });

  it('done reports the count + short sha and never claims a commit', () => {
    const body = renderScanComment('done', {
      savedFileCount: 2,
      commitSha: 'abcdef1234567',
    });
    expect(body).toContain('2 contract files');
    expect(body).toContain('abcdef1');
    expect(body).toContain('stored them in TrueCourse');
    expect(body).toMatch(/Nothing was committed/i);
    // no dashboardUrl → plain text, no markdown link
    expect(body).not.toContain('](http');
  });

  it('done renders a clickable dashboard link when a url is given', () => {
    const body = renderScanComment('done', {
      savedFileCount: 1,
      commitSha: 'abcdef1234567',
      dashboardUrl: 'https://app.example.com/repos/acme-api/contracts?commit=abcdef1234567',
    });
    expect(body).toContain(
      '[view them in the dashboard](https://app.example.com/repos/acme-api/contracts?commit=abcdef1234567)',
    );
  });

  it('done warns about unresolved conflicts and links them when a url is given', () => {
    const body = renderScanComment('done', {
      savedFileCount: 2,
      commitSha: 'abcdef1234567',
      openConflicts: 3,
      dashboardUrl: 'https://app.example.com/repos/acme-api/contracts?commit=abcdef1234567',
    });
    expect(body).toContain('3 unresolved spec conflicts');
    expect(body).toMatch(/drift gate stays neutral/i);
    expect(body).toContain(
      '[resolve them in the dashboard](https://app.example.com/repos/acme-api/contracts?commit=abcdef1234567)',
    );
  });

  it('done omits the conflict warning when there are none', () => {
    const body = renderScanComment('done', { savedFileCount: 1, commitSha: 'abcdef1', openConflicts: 0 });
    expect(body).not.toMatch(/unresolved spec conflict/i);
  });

  it('error re-offers a checkbox for retry', () => {
    const body = renderScanComment('error', { error: 'boom' });
    expect(body).toContain('boom');
    expect(body).toMatch(/- \[ \] Run TrueCourse scan/);
  });
});

describe('isScanComment / isScanCheckboxChecked', () => {
  it('only recognizes our marked comments', () => {
    expect(isScanComment('just a normal comment')).toBe(false);
    expect(isScanComment(undefined)).toBe(false);
    expect(isScanComment(null)).toBe(false);
  });

  it('detects a checked box regardless of bullet style', () => {
    expect(isScanCheckboxChecked('- [x] Run TrueCourse scan & regenerate contracts')).toBe(true);
    expect(isScanCheckboxChecked('* [x] Run TrueCourse scan & regenerate contracts')).toBe(true);
    expect(isScanCheckboxChecked('- [ ] Run TrueCourse scan & regenerate contracts')).toBe(false);
    expect(isScanCheckboxChecked('- [x] something unrelated')).toBe(false);
  });
});
