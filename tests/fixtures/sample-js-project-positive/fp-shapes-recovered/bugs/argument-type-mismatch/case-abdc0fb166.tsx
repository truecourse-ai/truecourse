// import { getBoundingClientRect } from '@documenso/lib/client-only/get-bounding-client-rect';
// import { useDocumentElement } from '@documenso/lib/client-only/hooks/use-document-element';
// import { getPdfPagesCount, PDF_VIEWER_PAGE_SELECTOR } from '@documenso/lib/constants/pdf-viewer';
// import { type TFieldMetaSchema, ZFieldMetaSchema } from '@documenso/lib/types/field-meta';
// import type { TRecipientLite } from '@documenso/lib/types/recipient';
// import { nanoid } from '@documenso/lib/universal/id';
// import { ADVANCED_FIELD_TYPES_WITH_OPTIONAL_SETTING } from '@documenso/lib/utils/advanced-fields-helpers';
// import { getDocumentDataUrlForPdfViewer } from '@documenso/lib/utils/envelope-download';
// import { getRecipientColorStyles } from '@documenso/ui/lib/recipient-colors';
// import { cn } from '@documenso/ui/lib/utils';
// import { Button } from '@documenso/ui/primitives/button';
// import { FieldItem } from '@documenso/ui/primitives/document-flow/field-item';
// import { FRIENDLY_FIELD_TYPE } from '@documenso/ui/primitives/document-flow/types';
// import { ElementVisible } from '@documenso/ui/primitives/element-visible';
// import { FieldSelector } from '@documenso/ui/primitives/field-selector';
// import { Form } from '@documenso/ui/primitives/form/form';
// import { RecipientSelector } from '@documenso/ui/primitives/recipient-selector';
// import { Sheet, SheetContent, SheetTrigger } from '@documenso/ui/primitives/sheet';
// import { useToast } from '@documenso/ui/primitives/use-toast';
// import { msg } from '@lingui/core/macro';
// import { useLingui } from '@lingui/react';
// import { Trans } from '@lingui/react/macro';
// import type { EnvelopeItem, FieldType } from '@prisma/client';
// import { ReadStatus, SendStatus, SigningStatus } from '@prisma/client';
// import { ChevronsUpDown } from 'lucide-react';
// import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// import { useFieldArray, useForm } from 'react-hook-form';
// import { useHotkeys } from 'react-hotkeys-hook';
// import { FieldAdvancedSettingsDrawer } from '~/components/embed/authoring/field-advanced-settings-drawer';
// import PDFViewerLazy from '~/components/general/pdf-viewer/pdf-viewer-lazy';
// import type { TConfigureEmbedFormSchema } from './configure-document-view.types';
// import type { TConfigureFieldsFormSchema } from './configure-fields-view.types';

// ── snippet ──
    (node: HTMLElement, index: number) => {
      const field = localFields[index];

      const $page = window.document.querySelector<HTMLElement>(
        `${PDF_VIEWER_PAGE_SELECTOR}[data-page-number="${field.pageNumber}"]`,
      );

      if (!$page) {
        return;
      }

      const { x: pageX, y: pageY, width: pageWidth, height: pageHeight } = getFieldPosition($page, node);

      update(index, {
        ...field,
        pageX,
        pageY,
        pageWidth,
        pageHeight,
      });
    },
    [getFieldPosition, localFields, update],
  );

  const onFieldMove = useCallback(
    (node: HTMLElement, index: number) => {
      const field = localFields[index];

      const $page = window.document.querySelector<HTMLElement>(
        `${PDF_VIEWER_PAGE_SELECTOR}[data-page-number="${field.pageNumber}"]`,
      );

      if (!$page) {
        return;
      }

      const { x: pageX, y: pageY } = getFieldPosition($page, node);

      update(index, {
        ...field,
        pageX,
        pageY,
      });
    },
    [getFieldPosition, localFields, update],
  );

  const handleUpdateFieldMeta = useCallback(
    (formId: string, fieldMeta: TFieldMetaSchema) => {
      const fieldIndex = localFields.findIndex((field) => field.formId === formId);

      if (fieldIndex !== -1) {
        const parsedFieldMeta = ZFieldMetaSchema.parse(fieldMeta);

        update(fieldIndex, {
          ...localFields[fieldIndex],
          fieldMeta: parsedFieldMeta,
        });
      }
    },
    [localFields, update],
  );

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

  useEffect(() => {
    const observer = new MutationObserver((_mutations) => {
      const $page = document.querySelector(PDF_VIEWER_PAGE_SELECTOR);

      if (!$page) {
        return;
      }

      fieldBounds.current = {
        height: Math.max(DEFAULT_HEIGHT_PX),
        width: Math.max(DEFAULT_WIDTH_PX),
      };
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  // Close drawer when a field is selected on mobile