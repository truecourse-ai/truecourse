
// FP shape fa64606fcf35: useCallback wrapping addField with spread and positional override — no type mismatch
declare function useCallback<T extends Function>(fn: T, deps: unknown[]): T;
declare function nanoid(size?: number): string;
declare function appendField(item: object): void;
declare function computeConstrainedPos(data: object): object;

type EditorField = { formId: string; fieldType: string; pageNumber: number; posX: number; posY: number; width: number; height: number };

const addEditorField = useCallback(
  (fieldData: Omit<EditorField, 'formId'>): EditorField => {
    const field: EditorField = {
      ...fieldData,
      formId: nanoid(12),
      ...computeConstrainedPos(fieldData),
    };

    appendField(field);
    return field;
  },
  [],
);



// FP shape fb8562007d14: useEffect with void executeActionAuthProcedure and dependency array — no type mismatch
declare function useEffect(fn: () => void | (() => void), deps: unknown[]): void;
declare function executeActionAuthProcedure(opts: { onReauthFormSubmit: (authOptions: object) => Promise<void>; actionTarget: string }): Promise<void>;
declare function onSign(authOptions: object): Promise<void>;
declare const shouldAutoSignField: boolean;
declare const fieldType: string;
declare const checkedValues: string[];
declare const isLengthConditionMet: boolean;
declare const isInserted: boolean;

useEffect(() => {
  if (shouldAutoSignField) {
    void executeActionAuthProcedure({
      onReauthFormSubmit: async (authOptions) => await onSign(authOptions),
      actionTarget: fieldType,
    });
  }
}, [checkedValues, isLengthConditionMet, isInserted]);



// FP shape fc28d7a08938: useRef + useElementBounds + computed styles — no type mismatch
declare function useRef<T>(init: T): { current: T };
declare function useState<T>(init: T): [T, (v: T | ((prev: T) => T)) => void];
declare function useElementBounds(selector: string): { left: number; top: number; width: number; height: number } | null;
declare function getRecipientColorStyles(index: number): { background: string; border: string };
declare function searchParams(): URLSearchParams;

const PDF_VIEWER_PAGE_SELECTOR = '[data-page]';

function FieldOverlay({ field, recipientIndex }: { field: { pageNumber: number; type: string }; recipientIndex: number }) {
  const [settingsActive, setSettingsActive] = useState(false);
  const elRef = useRef<HTMLDivElement>(null);
  const pageBounds = useElementBounds(`${PDF_VIEWER_PAGE_SELECTOR}[data-page-number="${field.pageNumber}"]`);
  const signerStyles = getRecipientColorStyles(recipientIndex);
  const isDevMode = searchParams().get('devmode') === 'true';

  const advancedFieldTypes = ['NUMBER', 'RADIO', 'CHECKBOX', 'DROPDOWN', 'TEXT', 'DATE'];

  return (
    <div ref={elRef} style={signerStyles}>
      {isDevMode && <span>dev</span>}
      <span>{field.type}</span>
    </div>
  );
}
