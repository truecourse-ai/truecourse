
// external-api-or-library-internals: intentional monkey-patching of private library internals; bracket used to override a property not exposed in TS types
declare const FabricUtil: { [key: string]: any };
declare class OffscreenCanvas { constructor(w: number, h: number) {} gpu: boolean; toString(): string; getContext(t: string): any; }

// @ts-expect-error skia-canvas satisfies the requirements
FabricUtil['createCanvasElement'] = () => {
  const node = new OffscreenCanvas(300, 300);
  node.gpu = false;
  node.toString = () => '[object HTMLCanvasElement]';
  return node;
};
