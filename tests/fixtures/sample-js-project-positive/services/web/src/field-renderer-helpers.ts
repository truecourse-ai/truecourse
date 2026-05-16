// --- cross-service-internal-import FP: shared UI library subpath import ---
// @myapp/ui is a public shared monorepo UI package; importing from its /lib/
// subpath is legitimate and should NOT be flagged as a cross-service internal
// access. The rule fires because the specifier looks like an internal module
// of a sibling service, but it is actually a published shared utility.

import { DEFAULT_FIELD_BACKGROUND, getAssigneeColorStyles } from '@myapp/ui/lib/assignee-colors';

declare const DEFAULT_FIELD_BACKGROUND: string;
declare function getAssigneeColorStyles(color: string): { baseRing: string; fill: string };

export const FIELD_FONT_FAMILY =
  '"Inter", "Inter Fallback", system-ui, sans-serif';
export const FIELD_TEXT_FILL = '#111827';

export interface FieldLayout {
  renderId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RenderOptions {
  pageWidth: number;
  pageHeight: number;
  editable: boolean;
  scale: number;
  color?: string;
  mode?: 'display' | 'export';
}

export function buildFieldRect(
  field: FieldLayout,
  options: RenderOptions,
): Record<string, unknown> {
  const { pageWidth, pageHeight, color, mode } = options;

  const maxX = (pageWidth - field.width) * options.scale;
  const maxY = (pageHeight - field.height) * options.scale;

  return {
    id: `${field.renderId}-rect`,
    name: 'field-rect',
    x: Math.min(field.x, maxX),
    y: Math.min(field.y, maxY),
    width: field.width,
    height: field.height,
    fill: DEFAULT_FIELD_BACKGROUND,
    stroke: color ? getAssigneeColorStyles(color).baseRing : '#e5e7eb',
    strokeWidth: 2,
    cornerRadius: 2,
    strokeScaleEnabled: false,
    visible: mode !== 'export',
  };
}



// Shape: group.name() === 'layer-group' && !items.some() — Konva-style name check, no type mismatch
declare const canvasLayer: { find: (selector: string) => Array<{ name: () => string; id: () => string; destroy: () => void }> };
declare const activeItems: Array<{ id: number }>;

export function removeStaleCanvasItems(): void {
  canvasLayer.find('Group').forEach((group) => {
    if (group.name() === 'layer-group' && !activeItems.some((item) => item.id.toString() === group.id())) {
      group.destroy();
    }
  });
}
