
// Konva Layer.find('Group') returns Node array — result immediately forEach'd
import { useRef } from 'react';

interface KonvaLayer {
  find(selector: string): KonvaNode[];
}
interface KonvaNode {
  id(): string;
  opacity(v?: number): number;
}

function updateFieldGroupOpacity(pageLayer: KonvaLayer, opacity: number): void {
  pageLayer.find('Group').forEach((group) => {
    group.opacity(opacity);
  });
}

export { updateFieldGroupOpacity };
