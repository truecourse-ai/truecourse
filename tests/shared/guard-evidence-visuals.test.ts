import { describe, it, expect } from 'vitest';
import {
  GUARD_VISUAL_CONTENT_TYPE,
  guardEvidenceVisual,
  guardEvidenceVisuals,
} from '../../packages/shared/src/index';

/**
 * The one place an evidence FILENAME becomes a meaning. The server lists and serves
 * by it, the client renders by it, so a disagreement here would show a screenshot
 * under the wrong step — or serve a video as an image.
 *
 * Classification is by EXTENSION; only the step index is name-derived. That is what
 * keeps the read additive: a bundle full of the text files every run has always
 * written yields no visuals at all, and renders exactly as it did.
 */

describe('reading one evidence filename', () => {
  it('reads a step screenshot as its kind AND its step', () => {
    expect(guardEvidenceVisual('step-1.png')).toEqual({ file: 'step-1.png', kind: 'screenshot', step: 1 });
    expect(guardEvidenceVisual('step-12.png')).toEqual({ file: 'step-12.png', kind: 'screenshot', step: 12 });
  });

  it('reads the session video as a video that belongs to no single step', () => {
    expect(guardEvidenceVisual('session.webm')).toEqual({ file: 'session.webm', kind: 'video' });
    // A `.png` naming no step is still a screenshot — the step is the optional half.
    expect(guardEvidenceVisual('final.png')).toEqual({ file: 'final.png', kind: 'screenshot' });
  });

  it('reads every TEXT file of the bundle as no visual at all', () => {
    for (const file of ['transcript.txt', 'invocation.json', 'stdout.raw.txt', 'diff.txt', 'files.txt']) {
      expect(guardEvidenceVisual(file)).toBeNull();
    }
    // Nothing without an extension, and nothing carrying a path.
    expect(guardEvidenceVisual('step-1')).toBeNull();
    expect(guardEvidenceVisual('.png')).toBeNull();
    expect(guardEvidenceVisual('nested/step-1.png')).toBeNull();
    expect(guardEvidenceVisual('..\\step-1.png')).toBeNull();
  });

  it('serves each kind as exactly one media type', () => {
    expect(GUARD_VISUAL_CONTENT_TYPE.screenshot).toBe('image/png');
    expect(GUARD_VISUAL_CONTENT_TYPE.video).toBe('video/webm');
  });
});

describe('reading a whole bundle', () => {
  it('orders the screenshots by STEP and closes with the video', () => {
    const listing = ['transcript.txt', 'session.webm', 'step-10.png', 'step-2.png', 'invocation.json', 'step-1.png'];
    expect(guardEvidenceVisuals(listing)).toEqual([
      { file: 'step-1.png', kind: 'screenshot', step: 1 },
      { file: 'step-2.png', kind: 'screenshot', step: 2 },
      { file: 'step-10.png', kind: 'screenshot', step: 10 },
      { file: 'session.webm', kind: 'video' },
    ]);
  });

  it('puts a stepless screenshot after the numbered ones', () => {
    expect(guardEvidenceVisuals(['final.png', 'step-2.png']).map((v) => v.file)).toEqual([
      'step-2.png',
      'final.png',
    ]);
  });

  it('answers EMPTY for the bundle a cli or api run writes', () => {
    expect(guardEvidenceVisuals(['transcript.txt', 'invocation.json', 'stdout.txt', 'diff.txt'])).toEqual([]);
    expect(guardEvidenceVisuals([])).toEqual([]);
  });
});
