declare function onBack(values: any): void;
declare const form: { getValues: () => any; formState: { isSubmitting: boolean; isValid: boolean } };

const ConfigureFieldsActions = () => {
  return (
    <div className="mt-6 flex gap-2">
      <button
        type="button"
        disabled={form.formState.isSubmitting}
        onClick={() => onBack(form.getValues())}
      >
        Back
      </button>
    </div>
  );
};


declare function nanoid(size: number): string;
declare const selectedField: string;
declare const pageNumber: number;
declare const pageX: number;
declare const pageY: number;
declare const fieldPageWidth: number;
declare const fieldPageHeight: number;
declare const recipientId: string;
declare const recipientEmail: string;
declare function append(field: any): void;

const addFieldAtPosition = () => {
  const field = {
    formId: nanoid(12),
    type: selectedField,
    pageNumber,
    pageX,
    pageY,
    pageWidth: fieldPageWidth,
    pageHeight: fieldPageHeight,
    recipientId,
    signerEmail: recipientEmail,
    fieldMeta: undefined,
  };

  append(field);
};


declare function nanoid(size: number): string;
declare function append(field: Record<string, any>): void;
declare const fieldClipboard: Record<string, any> | null;
declare const selectedRecipient: { email?: string; id?: number } | null;

function onFieldPaste() {
  if (fieldClipboard) {
    const copiedField = { ...fieldClipboard };
    append({
      ...copiedField,
      nativeId: undefined,
      formId: nanoid(12),
      signerEmail: selectedRecipient?.email ?? copiedField.signerEmail,
    });
  }
}



declare const useCallback2: <T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]) => T;
declare const useFieldArray2: (opts: { control: unknown; name: string }) => { fields: Array<{ id: string; formId: string; type: string; pageNumber: number; pageX: number; pageY: number; pageWidth: number; pageHeight: number; recipientId: string; signerEmail: string; fieldMeta?: unknown }>; append: (field: unknown) => void; update: (index: number, field: unknown) => void };
declare const useState13: <T>(v: T) => [T, (v: T) => void];
declare const nanoid2: (size: number) => string;
declare const getPage2: (event: MouseEvent, selector: string) => HTMLElement | null;
declare const getBoundingClientRect2: (el: HTMLElement) => { top: number; left: number; width: number; height: number; x: number; y: number };
declare const getFieldPosition2: (page: HTMLElement, node: HTMLElement) => { x: number; y: number; width: number; height: number; pageX: number; pageY: number; pageWidth: number; pageHeight: number };
declare const isWithinPageBounds2: (event: MouseEvent, selector: string, w: number, h: number) => boolean;
declare const PDF_VIEWER_PAGE_SELECTOR3: string;
declare const ADVANCED_FIELD_TYPES_WITH_OPTIONAL_SETTING2: string[];
declare const React: { FC: unknown; ReactNode: unknown };

export const useFieldPlacement2 = ({
  control,
  selectedField,
  selectedRecipient,
  setSelectedField,
  setCurrentField,
  setShowAdvancedSettings,
}: {
  control: unknown;
  selectedField: string | null;
  selectedRecipient: { id: string; email: string } | null;
  setSelectedField: (v: string | null) => void;
  setCurrentField: (v: unknown) => void;
  setShowAdvancedSettings: (v: boolean) => void;
}) => {
  const { fields: localFields, append, update } = useFieldArray2({ control, name: 'fields' });

  const fieldBounds = { current: { width: 120, height: 40 } };

  const onMouseMove = useCallback2(
    (event: MouseEvent) => {
      if (!selectedField || !selectedRecipient) return;

      const $page = getPage2(event, PDF_VIEWER_PAGE_SELECTOR3);
      if (!$page) return;

      getBoundingClientRect2($page);
    },
    [isWithinPageBounds2, selectedField],
  );

  const onMouseClick = useCallback2(
    (event: MouseEvent) => {
      if (!selectedField || !selectedRecipient) return;

      const $page = getPage2(event, PDF_VIEWER_PAGE_SELECTOR3);

      if (
        !$page ||
        !isWithinPageBounds2(event, PDF_VIEWER_PAGE_SELECTOR3, fieldBounds.current.width, fieldBounds.current.height)
      ) {
        return;
      }

      const { top, left, height, width } = getBoundingClientRect2($page);
      const pageNumber = parseInt($page.getAttribute('data-page-number') ?? '1', 10);

      let pageX = ((event.pageX - left) / width) * 100;
      let pageY = ((event.pageY - top) / height) * 100;

      const fieldPageWidth = (fieldBounds.current.width / width) * 100;
      const fieldPageHeight = (fieldBounds.current.height / height) * 100;

      pageX -= fieldPageWidth / 2;
      pageY -= fieldPageHeight / 2;

      const field = {
        formId: nanoid2(12),
        type: selectedField,
        pageNumber,
        pageX,
        pageY,
        pageWidth: fieldPageWidth,
        pageHeight: fieldPageHeight,
        recipientId: selectedRecipient.id,
        signerEmail: selectedRecipient.email,
        fieldMeta: undefined,
      };

      append(field);

      if (ADVANCED_FIELD_TYPES_WITH_OPTIONAL_SETTING2.includes(selectedField)) {
        setCurrentField(field);
        setShowAdvancedSettings(true);
      }

      setSelectedField(null);
    },
    [append, getPage2, isWithinPageBounds2, selectedField, selectedRecipient],
  );

  const onFieldResize = useCallback2(
    (node: HTMLElement, index: number) => {
      const field = localFields[index];

      const $page = window.document.querySelector<HTMLElement>(
        `${PDF_VIEWER_PAGE_SELECTOR3}[data-page-number="${field.pageNumber}"]`,
      );

      if (!$page) return;

      const { pageX, pageY, pageWidth, pageHeight } = getFieldPosition2($page, node);

      update(index, { ...field, pageX, pageY, pageWidth, pageHeight });
    },
    [localFields, update],
  );

  return { localFields, onMouseMove, onMouseClick, onFieldResize };
};
