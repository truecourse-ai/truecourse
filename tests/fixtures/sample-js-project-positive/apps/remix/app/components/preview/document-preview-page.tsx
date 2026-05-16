declare function generateWords(count: number): string;
declare const FieldType: { TEXT: 'TEXT'; NUMBER: 'NUMBER' };

function buildPreviewFieldValue(fieldType: string, charLimit?: number): string {
  if (fieldType === FieldType.TEXT) {
    let text = generateWords(5);
    if (charLimit) {
      text = text.slice(0, charLimit);
    }
    return text;
  }
  return '';
}
