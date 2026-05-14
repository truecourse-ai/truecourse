
declare const font: { widthOfTextAtSize: (text: string, size: number) => number };

function calculateTextXPosition(
  textAlign: string,
  fieldX: number,
  fieldWidth: number,
  textWidth: number,
  padding: number,
): number {
  let textX = fieldX + padding; // left-aligned default, initialized before the branches

  if (textAlign === 'center') {
    textX = fieldX + (fieldWidth - textWidth) / 2;
  } else if (textAlign === 'right') {
    textX = fieldX + fieldWidth - textWidth - padding;
  }

  return textX;
}
