
// Konva Stage optional chain + .find(selector) returns Node array — guarded for undefined stage
interface KonvaStage {
  find(selector: string): KonvaNode[];
}
interface KonvaNode {
  id(): string;
}

declare function getKonvaStageForPage(pageIndex: number): KonvaStage | undefined;

function countFieldsOnPage(pageIndex: number, fieldSelector: string): number {
  const stage = getKonvaStageForPage(pageIndex);
  return stage?.find(fieldSelector).length || 0;
}
