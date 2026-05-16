declare const cn: (...args: unknown[]) => string;
declare const FieldOverlay: (props: { fieldId: string; x: number; y: number; width: number; height: number; selected: boolean; onSelect: () => void; children?: React.ReactNode }) => JSX.Element;
declare const useFieldSelection: () => { selectedId: string | null; select: (id: string | null) => void };

type RenderedField = {
  id: string;
  type: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  value?: string;
};

type EditorPageRendererProps = {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  fields: RenderedField[];
  onFieldChange: (id: string, delta: Partial<RenderedField>) => void;
  readOnly?: boolean;
};

export function EditorPageRenderer({
  pageNumber,
  pageWidth,
  pageHeight,
  fields,
  onFieldChange,
  readOnly = false,
}: EditorPageRendererProps) {
  const { selectedId, select } = useFieldSelection();

  const pageFields = fields.filter((f) => f.page === pageNumber);

  return (
    <div
      className="relative overflow-hidden rounded border bg-white shadow"
      style={{ width: pageWidth, height: pageHeight }}
    >
      {pageFields.map((field) => (
        <FieldOverlay
          key={field.id}
          fieldId={field.id}
          x={field.x}
          y={field.y}
          width={field.width}
          height={field.height}
          selected={selectedId === field.id}
          onSelect={() => {
            if (!readOnly) select(field.id);
          }}
        >
          {field.type === 'text' && (
            <input
              className={cn(
                'h-full w-full border-0 bg-transparent px-1 text-sm outline-none',
                { 'pointer-events-none': readOnly },
              )}
              value={field.value ?? ''}
              placeholder={field.label}
              onChange={(e) => onFieldChange(field.id, { value: e.target.value })}
              readOnly={readOnly}
            />
          )}
          {field.type === 'signature' && (
            <div className="flex h-full w-full items-center justify-center">
              {field.value ? (
                <img src={field.value} alt="Signature" className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="text-xs text-muted-foreground">Sign here</span>
              )}
            </div>
          )}
          {field.type === 'date' && (
            <div className="flex h-full w-full items-center px-1">
              <span className="text-sm">{field.value ?? <span className="text-muted-foreground">Date</span>}</span>
            </div>
          )}
          {field.type === 'checkbox' && (
            <div className="flex h-full w-full items-center justify-center">
              <input type="checkbox" readOnly={readOnly} checked={field.value === 'true'} onChange={(e) => onFieldChange(field.id, { value: String(e.target.checked) })} />
            </div>
          )}
        </FieldOverlay>
      ))}
    </div>
  );
}
