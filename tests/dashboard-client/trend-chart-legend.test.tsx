/**
 * The Home tab's Violation Trend chart draws three series — total active, new
 * and resolved — and every one of them must be NAMED in the legend.
 *
 * The regression this pins: the total-active area was drawn with
 * `dataKey="active"` but registered in the chart config under `total` (via a
 * `name="total"` prop). `ChartLegendContent` resolves a series' label by
 * `item.dataKey`, never by its `name`, so `active` missed the config and the
 * legend rendered a bare colored swatch with no text next to "New" and
 * "Resolved". The config key must equal the dataKey.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TrendResponse } from '@/lib/api';
import { TrendChart } from '@/components/analytics/TrendChart';

// jsdom implements no layout and no ResizeObserver, so recharts'
// ResponsiveContainer measures 0×0 and renders no chart at all. Hand it a fixed
// box (it reads getBoundingClientRect() once on mount) and a no-op observer.
const realGetBoundingClientRect = Element.prototype.getBoundingClientRect;
const realResizeObserver = globalThis.ResizeObserver;

beforeAll(() => {
  Element.prototype.getBoundingClientRect = function () {
    return { width: 800, height: 300, top: 0, left: 0, bottom: 300, right: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterAll(() => {
  Element.prototype.getBoundingClientRect = realGetBoundingClientRect;
  globalThis.ResizeObserver = realResizeObserver;
});

function trend(): TrendResponse {
  return {
    points: [
      {
        analysisId: 'a1',
        date: '2026-08-10T10:00:00.000Z',
        branch: 'main',
        total: 5,
        new: 5,
        unchanged: 0,
        resolved: 0,
        critical: 1,
        high: 1,
        medium: 3,
        low: 0,
        info: 0,
      },
      {
        analysisId: 'a2',
        date: '2026-08-11T10:00:00.000Z',
        branch: 'main',
        total: 3,
        new: 1,
        unchanged: 2,
        resolved: 3,
        critical: 1,
        high: 2,
        medium: 0,
        low: 0,
        info: 0,
      },
    ],
  };
}

function legendItems(): string[] {
  const wrapper = document.querySelector('.recharts-legend-wrapper');
  expect(wrapper, 'the trend chart rendered no legend').not.toBeNull();
  const row = wrapper!.firstElementChild;
  return Array.from(row?.children ?? []).map((el) => (el.textContent ?? '').trim());
}

describe('TrendChart legend', () => {
  it('names every series it draws', () => {
    render(<TrendChart data={trend()} />);

    expect(legendItems()).toEqual(['Total Active', 'New', 'Resolved']);
  });

  it('renders no unlabeled legend swatch', () => {
    render(<TrendChart data={trend()} />);

    expect(legendItems().filter((t) => t === '')).toHaveLength(0);
  });

  it('still renders the card heading with two points', () => {
    render(<TrendChart data={trend()} />);

    expect(screen.getByText('Violation Trend')).toBeInTheDocument();
  });
});

describe('TrendChart header delta', () => {
  // The server's `total` is already the active count (new + unchanged). The
  // regression this pins: the chart computed `active: total - resolved`,
  // subtracting resolutions a second time — here 5→3 active read as −5
  // instead of −2, and any run resolving as much as stays active plotted 0.
  it('is the change in active counts, not double-subtracting resolved', () => {
    render(<TrendChart data={trend()} />);

    expect(screen.getByText('-2')).toBeInTheDocument();
    expect(screen.queryByText('-5')).not.toBeInTheDocument();
  });
});
