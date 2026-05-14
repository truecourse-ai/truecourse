
// FP shape: function with two typed positional parameters
declare type FieldToRender = { id: string; type: string; fieldMeta?: unknown };
declare type RenderFieldElementOptions = { pageWidth: number; pageHeight: number; pageLayer: unknown; mode: string; color: string };

export const renderDropdownFieldElement = (field: FieldToRender, options: RenderFieldElementOptions) => {
  const { pageWidth, pageHeight } = options;
  const fieldWidth = (field as { width?: number }).width ?? 100;
  const fieldHeight = (field as { height?: number }).height ?? 30;
  const padding = 8;
  const contentWidth = fieldWidth - padding * 2;
  const contentHeight = fieldHeight - padding * 2;
  return { contentWidth, contentHeight };
};
