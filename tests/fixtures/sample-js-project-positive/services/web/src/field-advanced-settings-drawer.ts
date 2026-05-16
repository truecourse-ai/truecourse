
// --- cross-service-internal-import FP: shared UI library primitives subpath ---
// @myapp/ui/primitives/sheet is a public primitive from the shared monorepo UI
// library. @myapp/ui is NOT a bounded service with protected internals — it is
// a shared package. The rule incorrectly flags this as a cross-service internal
// import because the specifier looks like a sibling service subpath.

import { Sheet, SheetContent, SheetTitle } from '@myapp/ui/primitives/sheet';
import { FieldAdvancedSettings } from '@myapp/ui/primitives/document-flow/field-item-advanced-settings';
import { FRIENDLY_FIELD_TYPE } from '@myapp/ui/primitives/document-flow/types';

declare const Sheet: React.ComponentType<{ open: boolean; onOpenChange: (open: boolean) => void; children?: React.ReactNode }>;
declare const SheetContent: React.ComponentType<{ position?: string; size?: string; className?: string; children?: React.ReactNode }>;
declare const SheetTitle: React.ComponentType<{ className?: string; children?: React.ReactNode }>;
declare const FieldAdvancedSettings: React.ComponentType<{ field: FieldConfig; fields: FieldConfig[]; onUpdate: (id: string, meta: FieldMeta) => void }>;
declare const FRIENDLY_FIELD_TYPE: Record<string, string>;

interface FieldMeta {
  required?: boolean;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
}

interface FieldConfig {
  id: string;
  type: string;
  required: boolean;
  meta: FieldMeta;
}

export type FieldAdvancedSettingsDrawerProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  currentField: FieldConfig | null;
  fields: FieldConfig[];
  onFieldUpdate: (fieldId: string, fieldMeta: FieldMeta) => void;
};

export function FieldAdvancedSettingsDrawer({
  isOpen,
  onOpenChange,
  currentField,
  fields,
  onFieldUpdate,
}: FieldAdvancedSettingsDrawerProps): JSX.Element | null {
  if (!currentField) {
    return null;
  }

  const friendlyType = FRIENDLY_FIELD_TYPE[currentField.type] ?? currentField.type;

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent position="right" size="lg" className="w-9/12 max-w-sm overflow-y-auto">
        <SheetTitle className="sr-only">
          {`Configure ${friendlyType} Field`}
        </SheetTitle>
        <FieldAdvancedSettings
          field={currentField}
          fields={fields}
          onUpdate={onFieldUpdate}
        />
      </SheetContent>
    </Sheet>
  );
}



// Shape: Array.includes() with string literal checking config key — no type mismatch
type FieldConfigKeys = 'maxLength' | 'minLength' | 'pattern' | 'placeholder' | 'defaultValue';

export function parseNumericFieldConfig(
  key: FieldConfigKeys,
  value: string | number | boolean,
): number | undefined {
  if (['maxLength', 'minLength'].includes(key)) {
    const parsed = Number(value);
    return isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}
