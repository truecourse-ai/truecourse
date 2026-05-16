
// --- argument-type-mismatch shape: react-ui-framework-apis (createPortal with numeric key) ---
import * as React from 'react';
declare function createPortal(children: React.ReactNode, container: Element): React.ReactPortal;
declare const Rnd: React.FC<{ key?: React.Key; className?: string; minHeight?: string; minWidth?: string; default?: object; bounds?: string; onDragStart?: () => void; children?: React.ReactNode }>;
declare function cn(...args: any[]): string;

interface FieldCoords { pageX: number; pageY: number; pageHeight: number; pageWidth: number; }
interface FieldItem { pageNumber: number; fieldMeta: unknown; }

export function renderFieldPortal(
  coords: FieldCoords,
  field: FieldItem,
  container: Element,
  active: boolean,
  passive: boolean,
  disabled: boolean,
) {
  const minHeight = '32px';
  const minWidth = '80px';

  return createPortal(
    <Rnd
      key={coords.pageX + coords.pageY + coords.pageHeight + coords.pageWidth}
      className={cn('field-item group', {
        'pointer-events-none': passive,
        'pointer-events-none cursor-not-allowed opacity-75': disabled,
        'z-50': active && !disabled,
        'z-20': !active && !disabled,
        'z-10': disabled,
      })}
      minHeight={minHeight}
      minWidth={minWidth}
      default={{
        x: coords.pageX,
        y: coords.pageY,
        height: coords.pageHeight,
        width: coords.pageWidth,
      }}
      bounds={`[data-page-number="${field.pageNumber}"]`}
      onDragStart={() => {}}
    />,
    container,
  );
}
