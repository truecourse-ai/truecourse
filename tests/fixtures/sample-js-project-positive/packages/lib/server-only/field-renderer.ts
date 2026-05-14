
// mode = 'edit' typed default parameter — function parameter with union type default
type RenderMode = 'edit' | 'preview' | 'readonly';

function renderTextField(
  fieldId: string,
  options: { mode?: RenderMode; pageWidth: number; pageHeight: number } = { pageWidth: 800, pageHeight: 1100 },
) {
  const { mode = 'edit', pageWidth, pageHeight } = options;
  return { fieldId, mode, pageWidth, pageHeight };
}
