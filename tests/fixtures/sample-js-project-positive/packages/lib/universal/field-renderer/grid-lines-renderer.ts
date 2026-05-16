
// Konva Stage.find('.field-group') CSS-selector find returns Node array, chained with filter+forEach
interface KonvaStage {
  find(selector: string): KonvaNode[];
}
interface KonvaNode {
  name(): string;
  id(): string;
  setAttr(attr: string, value: unknown): void;
}

declare const documentStage: KonvaStage;

function repositionAllFieldGroups(offsetX: number): void {
  documentStage.find('.field-group')
    .filter((node) => node.name() !== 'locked-field')
    .forEach((group) => {
      group.setAttr('x', offsetX);
    });
}
