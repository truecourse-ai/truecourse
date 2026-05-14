
// FP shape: function with destructured options param
type RenderLayoutOptions = {
  fieldWidth: number;
  fieldHeight: number;
  padding?: number;
  showLabel?: boolean;
};

const calculateRenderLayout = (field: { id: string; type: string }, options: RenderLayoutOptions) => {
  const { fieldWidth, fieldHeight, padding = 8, showLabel = true } = options;
  const contentWidth = fieldWidth - padding * 2;
  const contentHeight = fieldHeight - padding * 2;
  return { contentWidth, contentHeight, showLabel };
};
