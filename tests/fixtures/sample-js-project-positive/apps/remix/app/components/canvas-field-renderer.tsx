
// --- react-useless-set-state FP: setPendingFieldCreation with locally constructed object ---
declare function useState<T>(init: T): [T, (v: T | null) => void];
declare function useRef<T>(val: T): { current: T };
declare const Konva: {
  Rect: new (opts: { name: string; x: number; y: number; width: number; height: number; fill: string }) => { name: string };
  Stage: new (opts: { container: string }) => { on(evt: string, cb: (e: unknown) => void): void };
};

function CanvasFieldRenderer({ pageId }: { pageId: string }) {
  const [pendingFieldCreation, setPendingFieldCreation] = useState<{ name: string } | null>(null);
  const stage = useRef<{ on(e: string, cb: (e: unknown) => void): void } | null>(null);

  const setupDragSelection = (layer: { add(shape: { name: string }): void }) => {
    const pendingFieldCreation = new Konva.Rect({
      name: 'pending-field-creation',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      fill: 'rgba(24, 160, 251, 0.3)',
    });
    layer.add(pendingFieldCreation);
    setPendingFieldCreation(pendingFieldCreation);
  };

  return <div id={pageId} />;
}


// t(FIELD_TYPE_LABEL[field.type]) translation call with string argument — valid i18n call, no type mismatch
declare function t(msg: string): string;

const CANVAS_FIELD_TYPE_LABEL: Record<string, string> = {
  signature: 'Signature',
  initials: 'Initials',
  text: 'Text',
  date: 'Date',
  checkbox: 'Checkbox',
  radio: 'Radio',
  dropdown: 'Dropdown',
};

export function getCanvasFieldLabel(fieldType: string): string {
  return t(CANVAS_FIELD_TYPE_LABEL[fieldType]);
}



// Lingui _ macro receiving a MessageDescriptor — valid i18n call, no type mismatch
declare function _(descriptor: { id: string; message?: string }): string;
declare function msg(strings: TemplateStringsArray): { id: string; message: string };

const CANVAS_STATUS_LABELS: Record<string, string> = {
  placed: _(msg`Placed`),
  unplaced: _(msg`Unplaced`),
  signed: _(msg`Signed`),
  pending: _(msg`Pending`),
};



// createPortal with numeric sum as React key — sum of four coordinates auto-converts to string; no argument type mismatch
declare function createPortal(children: unknown, container: Element): unknown;
declare const DraggableField: (props: { 'data-field-id'?: string; className?: string; defaultPosition?: object; bounds?: string; onDragStart?: () => void }) => JSX.Element;
declare function cn(...args: unknown[]): string;

interface FieldBounds { x: number; y: number; height: number; width: number; }
interface PageField { pageNumber: number; fieldId: string; }

export function renderDraggableFieldPortal(
  bounds: FieldBounds,
  field: PageField,
  portalContainer: Element,
  isActive: boolean,
  isDisabled: boolean,
) {
  return createPortal(
    <DraggableField
      key={bounds.x + bounds.y + bounds.height + bounds.width}
      data-field-id={field.fieldId}
      className={cn('canvas-field', {
        'opacity-50 pointer-events-none': isDisabled,
        'ring-2 ring-primary z-50': isActive && !isDisabled,
      })}
      defaultPosition={{ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }}
      bounds={`[data-page="${field.pageNumber}"]`}
      onDragStart={() => {}}
    />,
    portalContainer,
  );
}



// Route module using trpc useQuery; root layout handles errors for all routes
declare function useQuery<T>(opts: { queryKey: unknown[] }): { data: T | undefined; isLoading: boolean };

export function ApiTokensSettings({ workspaceId }: { workspaceId: string }): JSX.Element | null {
  const { data: tokens, isLoading } = useQuery<Array<{ id: string; label: string }>>({ queryKey: ['api-tokens', workspaceId] });
  if (isLoading) return null;
  return <ul>{(tokens ?? []).map((t) => <li key={t.id}>{t.label}</li>)}</ul>;
}

