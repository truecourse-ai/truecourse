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

const MIN_HEIGHT_PX = 12;
const MIN_WIDTH_PX = 36;

const DEFAULT_HEIGHT_PX = MIN_HEIGHT_PX * 2.5;
const DEFAULT_WIDTH_PX = MIN_WIDTH_PX * 2.5;

export type ConfigureFieldsViewProps = {
  configData: TConfigureEmbedFormSchema;
  presignToken?: string | undefined;
  envelopeItem?: Pick<EnvelopeItem, 'id' | 'envelopeId' | 'documentDataId'>;
  defaultValues?: Partial<TConfigureFieldsFormSchema>;
  onBack?: (data: TConfigureFieldsFormSchema) => void;
  onSubmit: (data: TConfigureFieldsFormSchema) => void;
};

export const ConfigureFieldsView = ({