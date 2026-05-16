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



// Positive: filename-class-mismatch — this file patches the PDF rendering library for the
// server-side (Node canvas) backend and re-exports the configured instance under the library's own
// name. The export name is the third-party library being re-exported, not a class defined here.
declare const PdfRenderer: { prototype: { renderPage: (n: number) => void }; new (): unknown };
PdfRenderer.prototype.renderPage = function (pageNumber: number): void {
  void pageNumber; // no-op in server backend
};
export { PdfRenderer };

