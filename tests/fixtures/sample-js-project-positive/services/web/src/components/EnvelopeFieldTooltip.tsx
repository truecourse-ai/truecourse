/**
 * Paraphrased FP from documenso/documenso for
 * architecture/deterministic/data-layer-depends-on-external.
 *
 * The visitor previously classified this React component as the `data`
 * layer because it imports a type (`Field`) from `@prisma/client`, and
 * the sibling DOM helper as the `external` layer because its filename
 * contains "client". Neither side is actually doing data or external
 * work — the rule was firing on the file path + the `@prisma/client`
 * package name alone.
 *
 * Real example: packages/ui/components/field/envelope-field-tooltip.tsx
 * at documenso/documenso@8f6be474.
 */

import type { Field } from '@prisma/client';
import { getElementBox } from '../lib/dom-client-rect';

interface EnvelopeFieldTooltipProps {
  readonly field: Pick<Field, 'id' | 'page' | 'width' | 'height'>;
}

export function EnvelopeFieldTooltip(props: EnvelopeFieldTooltipProps): JSX.Element {
  const box = getElementBox({ getBoundingClientRect: () => ({ width: 100, height: 50 }) });
  return (
    <div data-page={props.field.page} data-w={box.width} data-h={box.height}>
      {props.field.id}
    </div>
  );
}
