
declare const selectMeta: any;
declare const DEFAULT_STANDARD_FONT_SIZE: number;
declare function upsertFieldGroup(field: any, options: any): any;
declare function upsertFieldRect(field: any, options: any): any;

function renderSelectField(field: any, options: any, mode: string) {
  let displayValue = 'Select an option';

  const fieldGroup = upsertFieldGroup(field, options);
  fieldGroup.removeChildren();

  const fieldRect = upsertFieldRect(field, options);
  fieldGroup.add(fieldRect);

  const fontSize = selectMeta?.fontSize || DEFAULT_STANDARD_FONT_SIZE;

  if (mode === 'export') {
    displayValue = '';
  }

  if (selectMeta?.readOnly && selectMeta.defaultValue) {
    displayValue = selectMeta.defaultValue;
  }

  if (field.inserted) {
    displayValue = field.customText;
  }

  return { fieldGroup, displayValue, fontSize };
}
