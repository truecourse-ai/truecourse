
// Konva Group.find('.checkbox-square') returns Node array, chained with .sort()
// Distinct from findOne() which can return undefined and is guarded separately
interface KonvaGroup {
  find(selector: string): KonvaNode[];
  findOne(selector: string): KonvaNode | undefined;
}
interface KonvaNode {
  id(): string;
  index: number;
  visible(v?: boolean): boolean;
}

declare const checkboxGroup: KonvaGroup;

function getOrderedCheckboxSquares(): KonvaNode[] {
  // findOne() can return undefined and must be guarded — but find() always returns an array
  const primarySquare = checkboxGroup.findOne('.primary-square');
  if (!primarySquare) {
    return [];
  }
  return checkboxGroup.find('.checkbox-square').sort((a, b) => a.index - b.index);
}
