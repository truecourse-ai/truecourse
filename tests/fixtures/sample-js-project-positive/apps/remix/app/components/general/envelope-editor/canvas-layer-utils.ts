
// Konva Layer.find('Group') returns Node array — result immediately consumed with forEach
interface KonvaLayer {
  find(selector: string): KonvaNode[];
}
interface KonvaNode {
  id(): string;
  visible(v?: boolean): boolean;
  destroy(): void;
}

declare const canvasLayer: KonvaLayer;

function clearAllFieldGroups(): void {
  canvasLayer.find('Group').forEach((group) => {
    group.destroy();
  });
}
