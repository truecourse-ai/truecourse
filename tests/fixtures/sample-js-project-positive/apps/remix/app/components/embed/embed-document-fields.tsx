
declare const matchFieldType: { with: (type: string, fn: () => React.ReactNode) => unknown; otherwise: (fn: () => null) => React.ReactNode };
declare const EmbedSignatureField: React.FC<{ field: unknown; onSign?: (v: unknown) => void; onUnsign?: (v: unknown) => void; typedEnabled?: boolean; uploadEnabled?: boolean; drawEnabled?: boolean }>;
declare const EmbedInitialsField: React.FC<{ field: unknown; onSign?: (v: unknown) => void; onUnsign?: (v: unknown) => void }>;
declare const EmbedTextField: React.FC<{ field: unknown; onSign?: (v: unknown) => void; onUnsign?: (v: unknown) => void }>;
declare const EmbedDateField: React.FC<{ field: unknown; onSign?: (v: unknown) => void; onUnsign?: (v: unknown) => void }>;
declare const EmbedCheckboxField: React.FC<{ field: unknown; onSign?: (v: unknown) => void; onUnsign?: (v: unknown) => void }>;
declare const ElementVisible: React.FC<{ target: string; children?: React.ReactNode }>;
declare const PDF_VIEWER_PAGE_SELECTOR_V2: string;
declare const React: { FC: unknown; ReactNode: unknown };

type EmbedFieldsV2Type = 'SIGNATURE' | 'INITIALS' | 'TEXT' | 'DATE' | 'CHECKBOX';

type EmbedField = { id: number; type: EmbedFieldsV2Type };

type EmbedFieldsMeta = {
  timezone?: string | null;
  typedSignatureEnabled?: boolean | null;
  uploadSignatureEnabled?: boolean | null;
  drawSignatureEnabled?: boolean | null;
} | null;

type EmbedFormFieldsV2Props = {
  fields: EmbedField[];
  metadata?: EmbedFieldsMeta;
  onSignField?: (value: unknown) => Promise<void> | void;
  onUnsignField?: (value: unknown) => Promise<void> | void;
};

export const EmbedFormFieldsV2 = ({ fields, metadata, onSignField, onUnsignField }: EmbedFormFieldsV2Props) => {
  return (
    <ElementVisible target={PDF_VIEWER_PAGE_SELECTOR_V2}>
      {fields.map((field) => {
        switch (field.type) {
          case 'SIGNATURE':
            return (
              <EmbedSignatureField
                key={field.id}
                field={field}
                onSign={onSignField}
                onUnsign={onUnsignField}
                typedEnabled={metadata?.typedSignatureEnabled ?? true}
                uploadEnabled={metadata?.uploadSignatureEnabled ?? true}
                drawEnabled={metadata?.drawSignatureEnabled ?? true}
              />
            );
          case 'INITIALS':
            return (
              <EmbedInitialsField
                key={field.id}
                field={field}
                onSign={onSignField}
                onUnsign={onUnsignField}
              />
            );
          case 'TEXT':
            return (
              <EmbedTextField
                key={field.id}
                field={field}
                onSign={onSignField}
                onUnsign={onUnsignField}
              />
            );
          case 'DATE':
            return (
              <EmbedDateField
                key={field.id}
                field={field}
                onSign={onSignField}
                onUnsign={onUnsignField}
              />
            );
          case 'CHECKBOX':
            return (
              <EmbedCheckboxField
                key={field.id}
                field={field}
                onSign={onSignField}
                onUnsign={onUnsignField}
              />
            );
          default:
            return null;
        }
      })}
    </ElementVisible>
  );
};



declare const match4: (v: unknown) => { with: (pattern: unknown, fn: () => unknown) => unknown; otherwise: (fn: () => unknown) => unknown; exhaustive: () => unknown };
declare const FieldType2: { SIGNATURE: string; INITIALS: string; NAME: string; DATE: string; EMAIL: string; TEXT: string; NUMBER: string; CHECKBOX: string; RADIO: string; DROPDOWN: string };
declare const ElementVisible2: React.FC<{ target: string; children?: React.ReactNode }>;
declare const DocumentSigningSignatureField2: React.FC<{ field: unknown; onSignField?: unknown; onUnsignField?: unknown; typedSignatureEnabled?: boolean; uploadSignatureEnabled?: boolean; drawSignatureEnabled?: boolean }>;
declare const DocumentSigningInitialsField2: React.FC<{ field: unknown; onSignField?: unknown; onUnsignField?: unknown }>;
declare const DocumentSigningNameField2: React.FC<{ field: unknown; onSignField?: unknown; onUnsignField?: unknown }>;
declare const DocumentSigningDateField2: React.FC<{ field: unknown; onSignField?: unknown; onUnsignField?: unknown; dateFormat?: string; timezone?: string }>;
declare const DocumentSigningEmailField2: React.FC<{ field: unknown; onSignField?: unknown; onUnsignField?: unknown }>;
declare const DocumentSigningTextField2: React.FC<{ field: unknown; onSignField?: unknown; onUnsignField?: unknown }>;
declare const DocumentSigningNumberField2: React.FC<{ field: unknown; onSignField?: unknown; onUnsignField?: unknown }>;
declare const DocumentSigningCheckboxField2: React.FC<{ field: unknown; onSignField?: unknown; onUnsignField?: unknown }>;
declare const PDF_VIEWER_PAGE_SELECTOR2: string;
declare const DEFAULT_DOCUMENT_DATE_FORMAT2: string;
declare const DEFAULT_DOCUMENT_TIME_ZONE2: string;
declare const ZTextFieldMeta2: { parse: (v: unknown) => unknown };
declare const ZNumberFieldMeta2: { parse: (v: unknown) => unknown };
declare const React: { FC: unknown; ReactNode: unknown };

type EmbedField2 = { id: string; type: string; fieldMeta?: unknown };

export const EmbedDocumentFields2 = ({
  fields,
  metadata,
  onSignField,
  onUnsignField,
}: {
  fields: EmbedField2[];
  metadata?: { dateFormat?: string; timezone?: string; typedSignatureEnabled?: boolean; uploadSignatureEnabled?: boolean; drawSignatureEnabled?: boolean } | null;
  onSignField?: (value: unknown) => Promise<void> | void;
  onUnsignField?: (value: unknown) => Promise<void> | void;
}) => {
  return (
    <ElementVisible2 target={PDF_VIEWER_PAGE_SELECTOR2}>
      {fields.map((field) =>
        match4(field.type)
          .with(FieldType2.SIGNATURE, () => (
            <DocumentSigningSignatureField2
              key={field.id}
              field={field}
              onSignField={onSignField}
              onUnsignField={onUnsignField}
              typedSignatureEnabled={metadata?.typedSignatureEnabled}
              uploadSignatureEnabled={metadata?.uploadSignatureEnabled}
              drawSignatureEnabled={metadata?.drawSignatureEnabled}
            />
          ))
          .with(FieldType2.INITIALS, () => (
            <DocumentSigningInitialsField2
              key={field.id}
              field={field}
              onSignField={onSignField}
              onUnsignField={onUnsignField}
            />
          ))
          .with(FieldType2.NAME, () => (
            <DocumentSigningNameField2
              key={field.id}
              field={field}
              onSignField={onSignField}
              onUnsignField={onUnsignField}
            />
          ))
          .with(FieldType2.DATE, () => (
            <DocumentSigningDateField2
              key={field.id}
              field={field}
              onSignField={onSignField}
              onUnsignField={onUnsignField}
              dateFormat={metadata?.dateFormat ?? DEFAULT_DOCUMENT_DATE_FORMAT2}
              timezone={metadata?.timezone ?? DEFAULT_DOCUMENT_TIME_ZONE2}
            />
          ))
          .with(FieldType2.EMAIL, () => (
            <DocumentSigningEmailField2
              key={field.id}
              field={field}
              onSignField={onSignField}
              onUnsignField={onUnsignField}
            />
          ))
          .with(FieldType2.TEXT, () => (
            <DocumentSigningTextField2
              key={field.id}
              field={{ ...field, fieldMeta: field.fieldMeta ? ZTextFieldMeta2.parse(field.fieldMeta) : null }}
              onSignField={onSignField}
              onUnsignField={onUnsignField}
            />
          ))
          .with(FieldType2.NUMBER, () => (
            <DocumentSigningNumberField2
              key={field.id}
              field={{ ...field, fieldMeta: field.fieldMeta ? ZNumberFieldMeta2.parse(field.fieldMeta) : null }}
              onSignField={onSignField}
              onUnsignField={onUnsignField}
            />
          ))
          .with(FieldType2.CHECKBOX, () => (
            <DocumentSigningCheckboxField2
              key={field.id}
              field={field}
              onSignField={onSignField}
              onUnsignField={onUnsignField}
            />
          ))
          .otherwise(() => null) as React.ReactNode
      )}
    </ElementVisible2>
  );
};
