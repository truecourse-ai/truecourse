
// Konva Group.find('.radio-circle') returns Node array — result immediately .sort()ed
interface KonvaGroup {
  find(selector: string): KonvaNode[];
}
interface KonvaNode {
  id(): string;
  index: number;
  getAttr(attr: string): unknown;
}

declare const radioGroup: KonvaGroup;

function getOrderedRadioCircles(): KonvaNode[] {
  return radioGroup.find('.radio-circle').sort((a, b) => a.index - b.index);
}
