// Bracket access after "in" guard — idiomatic defensive narrowing when property not typed
declare const canvasNode: object;

function applyNodeStyle(node: object): void {
  if ('style' in node) {
    // bracket notation required: 'style' not typed on the base object type
    const style = node['style'];
    console.log(style);
  }
  if ('transform' in node) {
    const transform = node['transform'];
    console.log(transform);
  }
}

function extractNodeData(node: object): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if ('id' in node) {
    result.id = node['id'];
  }
  if ('className' in node) {
    result.className = node['className'];
  }
  return result;
}


// Patches the canvas library for server-side rendering and re-exports the configured instance.
import type { Canvas } from 'canvas';
declare const canvasLib: Canvas;
canvasLib.prototype.toBuffer;
export { canvasLib as Canvas };
