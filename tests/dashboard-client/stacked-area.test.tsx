/**
 * The stacked area plot: what the bands are, and that a workspace with ONE
 * baseline run still gets a picture — the run's composition as a flat band from
 * its own time to the right edge, matching the tally beside it.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StackedArea, type StackedSeries } from '@/dashboard/ui/stacked-area';

type Status = 'proved' | 'failed';

const SERIES: StackedSeries<Status>[] = [
  { key: 'proved', label: 'Proved', fill: 'fill-emerald-500', dot: 'bg-emerald-500' },
  { key: 'failed', label: 'Failed', fill: 'fill-red-500', dot: 'bg-red-500' },
];

/** The vertices of a closed area path, as `[x, y]` pairs. */
function vertices(d: string): [number, number][] {
  return d
    .replace(/^M/, '')
    .replace(/\s*Z$/, '')
    .split(/\s*L\s*/)
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      return [x!, y!] as [number, number];
    });
}

function areas(container: HTMLElement): Map<string, [number, number][]> {
  const paths = [...container.querySelectorAll('svg path')].filter((p) =>
    (p.getAttribute('class') ?? '').includes('fill-'),
  );
  return new Map(
    paths.map((p) => {
      const fill = (p.getAttribute('class') ?? '').split(' ').find((c) => c.startsWith('fill-'))!;
      return [fill, vertices(p.getAttribute('d') ?? '')];
    }),
  );
}

describe('the stacked area plot', () => {
  it('draws a single point as a flat band across the whole plot', () => {
    const { container } = render(
      <StackedArea<Status>
        label="Sections over time"
        series={SERIES}
        points={[{ at: '2026-09-01', values: { proved: 12, failed: 6 } }]}
      />,
    );

    const proved = areas(container).get('fill-emerald-500')!;
    expect(proved).toHaveLength(4);
    // Left edge to right edge, and back along the baseline.
    expect(proved.map(([x]) => x)).toEqual([0, 1000, 1000, 0]);
    // The same composition across: the surface does not tilt.
    expect(proved[0]![1]).toBe(proved[1]![1]);
    // …and it has height, so the band is visible at all.
    expect(proved[0]![1]).toBeLessThan(proved[3]![1]);

    const failed = areas(container).get('fill-red-500')!;
    expect(failed.map(([x]) => x)).toEqual([0, 1000, 1000, 0]);
    // Stacked on top of the band below it: 6 of 18 above 12 of 18.
    expect(failed[0]![1]).toBe(0);
    expect(failed[3]![1]).toBe(proved[0]![1]);
  });

  it('says a lone point’s date once rather than at both ends', () => {
    const { container, rerender } = render(
      <StackedArea<Status>
        label="Sections over time"
        series={SERIES}
        points={[{ at: '2026-09-01', values: { proved: 12, failed: 6 } }]}
      />,
    );
    const dates = () => [...container.querySelectorAll('div.justify-between > span')].map((s) => s.textContent);
    expect(dates()).toEqual(['Sep 1']);

    rerender(
      <StackedArea<Status>
        label="Sections over time"
        series={SERIES}
        points={[
          { at: '2026-09-01', values: { proved: 12, failed: 6 } },
          { at: '2026-09-03', values: { proved: 14, failed: 4 } },
        ]}
      />,
    );
    expect(dates()).toEqual(['Sep 1', 'Sep 3']);
  });

  it('spans the plot across several points, one column each', () => {
    const { container } = render(
      <StackedArea<Status>
        label="Sections over time"
        series={SERIES}
        points={[
          { at: '2026-09-01', values: { proved: 12, failed: 6 } },
          { at: '2026-09-02', values: { proved: 15, failed: 3 } },
          { at: '2026-09-03', values: { proved: 18, failed: 0 } },
        ]}
      />,
    );

    const proved = areas(container).get('fill-emerald-500')!;
    expect(proved.map(([x]) => x)).toEqual([0, 500, 1000, 1000, 500, 0]);
    // The surface climbs as the proved share grows.
    expect(proved[0]![1]).toBeGreaterThan(proved[2]![1]);
  });
});
