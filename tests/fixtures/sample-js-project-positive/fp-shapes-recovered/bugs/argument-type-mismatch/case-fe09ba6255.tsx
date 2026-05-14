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
  formId: string;
  pageNumber: number;
  type: FieldType;
  pageX: number;
  pageY: number;
  pageWidth: number;
  pageHeight: number;
  signerEmail: string;
  recipientId: number;
  fieldMeta?: FieldMeta;
};

export type AddFieldsFormProps = {
  documentFlow: DocumentFlowStep;
  hideRecipients?: boolean;
  recipients: TRecipientLite[];
  fields: Field[];
  onSubmit: (_data: TAddFieldsFormSchema) => void;
  onAutoSave: (_data: TAddFieldsFormSchema) => Promise<void>;
  canGoBack?: boolean;
  isDocumentPdfLoaded: boolean;
  teamId: number;
};

export const AddFieldsFormPartial = ({
  documentFlow,
  hideRecipients = false,
  recipients,
  fields,
  onSubmit,
  onAutoSave,
  canGoBack = false,
  isDocumentPdfLoaded,
  teamId,
}: AddFieldsFormProps) => {
  const { toast } = useToast();
  const { _ } = useLingui();

  const [isMissingSignatureDialogVisible, setIsMissingSignatureDialogVisible] = useState(false);

  const { isWithinPageBounds, getFieldPosition, getPage } = useDocumentElement();
  const { currentStep, totalSteps, previousStep } = useStep();
  const canRenderBackButtonAsRemove = currentStep === 1 && typeof documentFlow.onBackStep === 'function' && canGoBack;
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [currentField, setCurrentField] = useState<FieldFormType>();
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);

  const form = useForm<TAddFieldsFormSchema>({
    defaultValues: {
      fields: fields.map((field) => ({
        nativeId: field.id,
        formId: `${field.id}-${field.envelopeItemId}`,
        pageNumber: field.page,
        type: field.type,
        pageX: Number(field.positionX),
        pageY: Number(field.positionY),
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