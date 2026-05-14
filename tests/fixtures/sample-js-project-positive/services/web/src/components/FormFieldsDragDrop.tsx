// UI component that uses browser DOM APIs and imports from a sibling
// module named 'server-actions' (which contains plain S3 infra helpers).
// The rule must NOT fire here because the importer is a UI component,
// not a data-layer module.

declare function getElementBoundingRect(el: Element): { top: number; left: number; width: number; height: number };
declare function usePageTracker(): { isWithinBounds: (e: MouseEvent, sel: string, w: number, h: number) => boolean; getPage: (e: MouseEvent, sel: string) => Element | null };
declare function useFormEditor(): { form: { recipients: Array<{ id: number; status: string }>; fields: unknown[] }; editorFields: { addField: (f: unknown) => void }; isTemplate: boolean; getRecipientStyle: (id: number) => string };
declare function canRecipientBeEdited(recipient: { id: number; status: string }, fields: unknown[]): boolean;
declare function generateId(len: number): string;
declare const FIELD_DEFAULTS: Record<string, unknown>;
declare const PAGE_SELECTOR: string;

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uploadFieldAttachment } from './server-actions';

const MIN_HEIGHT = 12;
const MIN_WIDTH = 36;
const DEFAULT_HEIGHT = MIN_HEIGHT * 2.5;
const DEFAULT_WIDTH = MIN_WIDTH * 2.5;

type FieldType = 'text' | 'signature' | 'date' | 'checkbox';

type FormFieldsDragDropProps = {
  selectedRecipientId: number | null;
  selectedFormItemId: string | null;
};

export const FormFieldsDragDrop = ({
  selectedRecipientId,
  selectedFormItemId,
}: FormFieldsDragDropProps): JSX.Element => {
  const { form, editorFields, isTemplate, getRecipientStyle } = useFormEditor();
  const { isWithinBounds, getPage } = usePageTracker();

  const [selectedField, setSelectedField] = useState<FieldType | null>(null);

  const isFieldsDisabled = useMemo(() => {
    const signer = form.recipients.find((r) => r.id === selectedRecipientId);
    if (!signer) return true;
    if (isTemplate) return false;
    return !canRecipientBeEdited(signer, form.fields);
  }, [selectedRecipientId, form.recipients, form.fields, isTemplate]);

  const [isWithinPage, setIsWithinPage] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });

  const fieldBounds = useRef({ height: 0, width: 0 });

  const onMouseMove = useCallback(
    (event: MouseEvent) => {
      setIsWithinPage(
        isWithinBounds(event, PAGE_SELECTOR, fieldBounds.current.width, fieldBounds.current.height),
      );
      setCoords({
        x: event.clientX - fieldBounds.current.width / 2,
        y: event.clientY - fieldBounds.current.height / 2,
      });
    },
    [isWithinBounds],
  );

  const onMouseClick = useCallback(
    (event: MouseEvent) => {
      if (!selectedField || !selectedRecipientId || !selectedFormItemId) return;

      const $page = getPage(event, PAGE_SELECTOR);
      if (
        !$page ||
        !isWithinBounds(event, PAGE_SELECTOR, fieldBounds.current.width, fieldBounds.current.height)
      ) {
        setSelectedField(null);
        return;
      }

      const { top, left, height, width } = getElementBoundingRect($page);
      const pageNumber = parseInt($page.getAttribute('data-page-number') ?? '1', 10);

      let pageX = ((event.pageX - left) / width) * 100;
      let pageY = ((event.pageY - top) / height) * 100;

      const fieldPageWidth = (fieldBounds.current.width / width) * 100;
      const fieldPageHeight = (fieldBounds.current.height / height) * 100;

      pageX -= fieldPageWidth / 2;
      pageY -= fieldPageHeight / 2;

      const field = {
        formId: generateId(12),
        formItemId: selectedFormItemId,
        type: selectedField,
        page: pageNumber,
        positionX: pageX,
        positionY: pageY,
        width: fieldPageWidth,
        height: fieldPageHeight,
        recipientId: selectedRecipientId,
        fieldMeta: structuredClone(FIELD_DEFAULTS[selectedField]),
      };

      editorFields.addField(field);
      // Also persist the field thumbnail via S3 (plain infra util, not a Next.js action)
      void uploadFieldAttachment(field.formId, selectedField);

      setIsWithinPage(false);
      setSelectedField(null);
    },
    [isWithinBounds, selectedField, selectedRecipientId, selectedFormItemId, getPage, editorFields],
  );

  useEffect(() => {
    const observer = new MutationObserver((_mutations) => {
      const $page = document.querySelector(PAGE_SELECTOR);
      if (!$page) return;
      fieldBounds.current = {
        height: Math.max(DEFAULT_HEIGHT),
        width: Math.max(DEFAULT_WIDTH),
      };
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (selectedField) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseClick);
    }
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseClick);
    };
  }, [onMouseClick, onMouseMove, selectedField]);

  const recipientStyles = useMemo(
    () => getRecipientStyle(selectedRecipientId ?? -1),
    [selectedRecipientId, getRecipientStyle],
  );

  const fieldTypes: FieldType[] = ['signature', 'text', 'date', 'checkbox'];

  return (
    <div className="grid grid-cols-2 gap-2">
      {fieldTypes.map((type) => (
        <button
          key={type}
          type="button"
          disabled={isFieldsDisabled}
          onClick={() => setSelectedField(type)}
          onMouseDown={() => setSelectedField(type)}
          data-selected={selectedField === type ? true : undefined}
          className={`flex h-12 cursor-pointer items-center justify-center rounded-lg border ${recipientStyles}`}
        >
          <span className="text-sm font-normal capitalize">{type}</span>
        </button>
      ))}
      {isWithinPage && selectedField && (
        <div
          style={{ position: 'fixed', left: coords.x, top: coords.y, pointerEvents: 'none' }}
          className="rounded border-2 border-dashed border-primary bg-primary/10"
        >
          <span className="text-xs">{selectedField}</span>
        </div>
      )}
    </div>
  );
};
