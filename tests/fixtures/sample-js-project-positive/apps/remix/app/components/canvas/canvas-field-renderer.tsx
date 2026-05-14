
// FF09 — Array.some comparing field ID against canvas group id(); both strings
type CanvasFieldItem = { formId: string; type: string };
declare const pageFields: CanvasFieldItem[];
declare const canvasGroup: { id(): string; name(): string };

const groupHasMatchingField = pageFields.some(
  (field) => field.formId === canvasGroup.id()
);



// FF16 — useMemo wrapping Array.filter; standard React hook, no type mismatch
declare function useMemo<T>(factory: () => T, deps: unknown[]): T;
type LayerField = { layerId: string; visible: boolean; type: string };
declare const editorState: { allFields: LayerField[] };
declare const activeLayerId: string;

const visibleFields = useMemo(
  () => editorState.allFields.filter((f) => f.layerId === activeLayerId && f.visible),
  [editorState.allFields, activeLayerId]
);



// FF22 — .map() on canvas groups to produce string[]; types match
declare const selectedCanvasGroups: Array<{ id(): string; name(): string }>;

const selectedGroupIds: string[] = selectedCanvasGroups.map((group) => group.id());



// --- argument-type-mismatch FP: useHotkeys with KeyboardEvent passed to handler ---
declare function useHotkeys(
  keys: string[],
  handler: (event: KeyboardEvent) => void,
): void;

function FieldEditor({ onFieldCopy }: { onFieldCopy: (evt: KeyboardEvent) => void }) {
  useHotkeys(['ctrl+c', 'meta+c'], (evt) => onFieldCopy(evt));
  return null;
}



// --- argument-type-mismatch FP: useMemo with length guard returning null ---
declare function useMemo<T>(factory: () => T, deps: unknown[]): T;

interface FieldSelection {
  fieldId: string;
  pageIndex: number;
}

function FieldSelectionRenderer({
  selectedFieldIds,
}: {
  selectedFieldIds: string[];
}) {
  const selectedFieldRenderer = useMemo(() => {
    if (selectedFieldIds.length === 0) {
      return null;
    }
    return selectedFieldIds.map((id) => <div key={id} className="field-highlight" />);
  }, [selectedFieldIds]);

  return <div>{selectedFieldRenderer}</div>;
}



// --- argument-type-mismatch FP: ts-pattern match inside array map ---
declare const match: <T>(val: T) => {
  with<P>(pattern: P, fn: (val: T) => string): { otherwise(fn: (val: T) => string): string };
};

enum FieldKind {
  TEXT = 'TEXT',
  CHECKBOX = 'CHECKBOX',
  SIGNATURE = 'SIGNATURE',
  DATE = 'DATE',
}

interface FormField {
  id: string;
  type: FieldKind;
  label: string;
}

function getFieldIcons(fields: FormField[]): string[] {
  return fields.map((field) =>
    match(field.type)
      .with(FieldKind.TEXT, () => 'text-cursor')
      .otherwise(() => 'square')
  );
}



// --- argument-type-mismatch FP: React state updater with Array.map transformation ---
declare function useState<T>(init: T): [T, (updater: T | ((prev: T) => T)) => void];

interface CanvasField {
  id: string;
  type: string;
  x: number;
  y: number;
  required: boolean;
}

function FieldEditor() {
  const [fields, setFields] = useState<CanvasField[]>([]);

  function markFieldRequired(fieldId: string): void {
    setFields((fields) =>
      fields.map((field) =>
        field.id === fieldId ? { ...field, required: true } : field,
      ),
    );
  }

  return null;
}



// FP shape: color is obtained via getFieldColor which uses modulo on AVAILABLE_FIELD_COLORS length,
// so it always yields a valid TFieldColor. FIELD_COLOR_STYLES is a Record keyed by TFieldColor — access is always valid.
declare type TFieldColor = 'blue' | 'green' | 'purple' | 'orange';
declare const AVAILABLE_FIELD_COLORS: TFieldColor[];
declare function getFieldColor(index: number): TFieldColor;

const FIELD_COLOR_STYLES: Record<TFieldColor, { bg: string; border: string }> = {
  blue: { bg: 'bg-blue-100', border: 'border-blue-400' },
  green: { bg: 'bg-green-100', border: 'border-green-400' },
  purple: { bg: 'bg-purple-100', border: 'border-purple-400' },
  orange: { bg: 'bg-orange-100', border: 'border-orange-400' },
};

function renderFields(recipients: Array<{ id: number; name: string }>) {
  return recipients.map((recipient, idx) => {
    const color = getFieldColor(idx);
    const styles = FIELD_COLOR_STYLES[color];
    return { recipientId: recipient.id, name: recipient.name, ...styles };
  });
}



// FP shape: index is the .map() loop variable from localItems.map((item, index) => ...) and is captured
// in an event callback closed over that same localItems. The callback is recreated whenever localItems changes
// so the captured index is always a valid index into localItems — standard idiomatic React form-array handling.
declare type TCanvasItem = { id: string; x: number; y: number; width: number; height: number };
declare function useCallback<T extends Function>(fn: T, deps: unknown[]): T;
declare const localItems: TCanvasItem[];
declare function updateItem(index: number, item: TCanvasItem): void;

function CanvasFieldList({
  items,
  onItemResize,
}: {
  items: TCanvasItem[];
  onItemResize: (index: number, width: number, height: number) => void;
}) {
  return items.map((item, index) => {
    const handleResize = useCallback(
      (w: number, h: number) => {
        onItemResize(index, w, h);
        updateItem(index, { ...items[index], width: w, height: h });
      },
      [items, index],
    );
    return { item, handleResize };
  });
}



// FP shape: arithmetic-loop-bounds-guaranteed — b = points[i+1]; i<max=len-1 so i+1<=len-1 which is
// the last valid index. Access is within bounds.
function computeStrokePath(points: number[][]): string {
  const len = points.length;
  if (len < 4) {
    return '';
  }

  const avg = (x: number, y: number) => (x + y) / 2;

  let a = points[0]!;
  let b = points[1]!;
  const c = points[2]!;

  let result = `M${a[0]!.toFixed(2)},${a[1]!.toFixed(2)} Q${b[0]!.toFixed(2)},${b[1]!.toFixed(2)} ${avg(b[0]!, c[0]!).toFixed(2)},${avg(b[1]!, c[1]!).toFixed(2)} T`;

  for (let i = 2, max = len - 1; i < max; i++) {
    a = points[i];
    b = points[i + 1];
    result += `${avg(a[0]!, b[0]!).toFixed(2)},${avg(a[1]!, b[1]!).toFixed(2)} `;
  }

  result += 'Z';
  return result;
}



// FP shape: arithmetic-loop-bounds-guaranteed — loop is for(let i=2, max=len-1; i<max; i++)
// so i ranges 2..len-2; points[i] is within bounds. Early return when len<4 guards degenerate cases.
function computeControlPoints(points: Array<[number, number]>): Array<[number, number]> {
  const len = points.length;
  if (len < 4) {
    return [];
  }

  const controls: Array<[number, number]> = [];
  for (let i = 2, max = len - 1; i < max; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    controls.push([
      (prev[0] + curr[0] + next[0]) / 3,
      (prev[1] + curr[1] + next[1]) / 3,
    ]);
  }
  return controls;
}



// FP shape: FIELD_META_DEFAULT_VALUES is a Record keyed by FieldType enum;
// fieldType is typed FieldType at call site. Enum-exhaustive Record lookup.
declare const enum CanvasFieldType { TEXT = 'TEXT', SIGNATURE = 'SIGNATURE', DATE = 'DATE', CHECKBOX = 'CHECKBOX', INITIALS = 'INITIALS' }

interface FieldMetaDefaults { width: number; height: number; fontSize: number; required: boolean }

const CANVAS_FIELD_META_DEFAULTS = {
  [CanvasFieldType.TEXT]: { width: 200, height: 40, fontSize: 14, required: false },
  [CanvasFieldType.SIGNATURE]: { width: 240, height: 80, fontSize: 16, required: true },
  [CanvasFieldType.DATE]: { width: 160, height: 40, fontSize: 14, required: false },
  [CanvasFieldType.CHECKBOX]: { width: 32, height: 32, fontSize: 12, required: false },
  [CanvasFieldType.INITIALS]: { width: 120, height: 60, fontSize: 16, required: true },
} satisfies Record<CanvasFieldType, FieldMetaDefaults>;

function getFieldMetaDefaults(fieldType: CanvasFieldType): FieldMetaDefaults {
  return CANVAS_FIELD_META_DEFAULTS[fieldType];
}
