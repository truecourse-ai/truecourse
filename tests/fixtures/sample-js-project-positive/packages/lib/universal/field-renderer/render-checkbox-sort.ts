
// Konva Group.find('.checkbox-square') returns Node array, immediately chained with .sort()
interface KonvaGroup {
  find(selector: string): KonvaNode[];
}
interface KonvaNode {
  id(): string;
  index: number;
  checked?: boolean;
  setAttr(attr: string, value: unknown): void;
}

declare const checkboxFieldGroup: KonvaGroup;

function sortCheckboxSquaresByIndex(): KonvaNode[] {
  return checkboxFieldGroup.find('.checkbox-square').sort((a, b) => a.index - b.index);
}
