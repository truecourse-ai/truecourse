// import { getBoundingClientRect } from '@documenso/lib/client-only/get-bounding-client-rect';
// import { useAutoSave } from '@documenso/lib/client-only/hooks/use-autosave';
// import { useDocumentElement } from '@documenso/lib/client-only/hooks/use-document-element';
// import { getPdfPagesCount, PDF_VIEWER_PAGE_SELECTOR } from '@documenso/lib/constants/pdf-viewer';
// import { type TFieldMetaSchema as FieldMeta, ZFieldMetaSchema } from '@documenso/lib/types/field-meta';
// import type { TRecipientLite } from '@documenso/lib/types/recipient';
// import { nanoid } from '@documenso/lib/universal/id';
// import { ADVANCED_FIELD_TYPES_WITH_OPTIONAL_SETTING } from '@documenso/lib/utils/advanced-fields-helpers';
// import { validateFieldsUninserted } from '@documenso/lib/utils/fields';
// import { parseMessageDescriptor } from '@documenso/lib/utils/i18n';
import {
// import { zodResolver } from '@hookform/resolvers/zod';
// import { msg } from '@lingui/core/macro';
// import { useLingui } from '@lingui/react';
// import { Trans } from '@lingui/react/macro';
// import type { Field } from '@prisma/client';
// import { FieldType, Prisma, RecipientRole, SendStatus } from '@prisma/client';
// import { CalendarDays, CheckSquare, ChevronDown, Contact, Disc, Hash, Mail, Type, User } from 'lucide-react';
// import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// import { useFieldArray, useForm } from 'react-hook-form';
// import { useHotkeys } from 'react-hotkeys-hook';
// import { FieldToolTip } from '../../components/field/field-tooltip';
// import { getRecipientColorStyles } from '../../lib/recipient-colors';
// import { cn } from '../../lib/utils';
// import { Alert, AlertDescription } from '../alert';
// import { Card, CardContent } from '../card';
// import { Form } from '../form/form';
// import { RecipientSelector } from '../recipient-selector';
// import { useStep } from '../stepper';
// import { useToast } from '../use-toast';
// import { type TAddFieldsFormSchema, ZAddFieldsFormSchema } from './add-fields.types';
import {
// import { FieldItem } from './field-item';
// import { FieldAdvancedSettings } from './field-item-advanced-settings';
// import { MissingSignatureFieldDialog } from './missing-signature-field-dialog';
// import { type DocumentFlowStep, FRIENDLY_FIELD_TYPE } from './types';

// ── snippet ──
        pageWidth: Number(field.width),
        pageHeight: Number(field.height),
        signerEmail: recipients.find((recipient) => recipient.id === field.recipientId)?.email ?? '',
        recipientId: field.recipientId,
        fieldMeta: field.fieldMeta ? ZFieldMetaSchema.parse(field.fieldMeta) : undefined,
      })),
    },
    resolver: zodResolver(ZAddFieldsFormSchema),
  });

  useHotkeys(['ctrl+c', 'meta+c'], (evt) => onFieldCopy(evt));
  useHotkeys(['ctrl+v', 'meta+v'], (evt) => onFieldPaste(evt));
  useHotkeys(['ctrl+d', 'meta+d'], (evt) => onFieldCopy(evt, { duplicate: true }));

  const onFormSubmit = form.handleSubmit(onSubmit);

  const handleSavedFieldSettings = (fieldState: FieldMeta) => {
    const initialValues = form.getValues();

    const updatedFields = initialValues.fields.map((field) => {
      if (field.formId === currentField?.formId) {
        const parsedFieldMeta = ZFieldMetaSchema.parse(fieldState);

        return {
          ...field,
          fieldMeta: parsedFieldMeta,
        };
      }

      return field;
    });

    form.setValue('fields', updatedFields);
  };

  const {
    append,
    remove,
    update,
    fields: localFields,
  } = useFieldArray({
    control: form.control,
    name: 'fields',
  });

  const [selectedField, setSelectedField] = useState<FieldType | null>(null);
  const [selectedSigner, setSelectedSigner] = useState<TRecipientLite | null>(null);
  const [lastActiveField, setLastActiveField] = useState<TAddFieldsFormSchema['fields'][0] | null>(null);
  const [fieldClipboard, setFieldClipboard] = useState<TAddFieldsFormSchema['fields'][0] | null>(null);
  const selectedSignerIndex = recipients.findIndex((r) => r.id === selectedSigner?.id);
  const selectedSignerStyles = getRecipientColorStyles(selectedSignerIndex);

  const [validateUninsertedFields, setValidateUninsertedFields] = useState(false);

  const filterFieldsWithEmptyValues = (fields: typeof localFields, fieldType: string) =>
    fields
      .filter((field) => field.type === fieldType)
      .filter((field) => {
        if (field.fieldMeta && 'values' in field.fieldMeta) {
          return field.fieldMeta.values?.length === 0;
        }

        return true;
      });

  const emptyCheckboxFields = useMemo(
    () => filterFieldsWithEmptyValues(localFields, FieldType.CHECKBOX),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [localFields],
  );

  const emptyRadioFields = useMemo(
    () => filterFieldsWithEmptyValues(localFields, FieldType.RADIO),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [localFields],
  );

  const emptySelectFields = useMemo(
    () => filterFieldsWithEmptyValues(localFields, FieldType.DROPDOWN),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [localFields],
  );

  const hasErrors = emptyCheckboxFields.length > 0 || emptyRadioFields.length > 0 || emptySelectFields.length > 0;

  const fieldsWithError = useMemo(() => {
    const fields = localFields.filter((field) => {
      const hasError =
        ((field.type === FieldType.CHECKBOX || field.type === FieldType.RADIO || field.type === FieldType.DROPDOWN) &&
          field.fieldMeta === undefined) ||
        (field.fieldMeta && 'values' in field.fieldMeta && field?.fieldMeta?.values?.length === 0);

      return hasError;
    });

    const mappedFields = fields.map((field) => ({
      id: field.nativeId ?? 0,
      secondaryId: field.formId,
      documentId: null,
      templateId: null,