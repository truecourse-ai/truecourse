// Single file checks event.type === 'dragend' — DOM event name used once
interface DragEvent {
  type: string;
  clientX: number;
  clientY: number;
}

function handleDragEvent(event: DragEvent) {
  if (event.type === 'dragend') {
    finalizeDrop(event.clientX, event.clientY);
    return;
  }
  updateDragPosition(event.clientX, event.clientY);
}

declare function finalizeDrop(x: number, y: number): void;
declare function updateDragPosition(x: number, y: number): void;
