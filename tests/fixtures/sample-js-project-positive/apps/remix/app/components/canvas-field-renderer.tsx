
// --- react-useless-set-state FP: setPendingFieldCreation with locally constructed object ---
declare function useState<T>(init: T): [T, (v: T | null) => void];
declare function useRef<T>(val: T): { current: T };
declare const Konva: {
  Rect: new (opts: { name: string; x: number; y: number; width: number; height: number; fill: string }) => { name: string };
  Stage: new (opts: { container: string }) => { on(evt: string, cb: (e: unknown) => void): void };
};

function CanvasFieldRenderer({ pageId }: { pageId: string }) {
  const [pendingFieldCreation, setPendingFieldCreation] = useState<{ name: string } | null>(null);
  const stage = useRef<{ on(e: string, cb: (e: unknown) => void): void } | null>(null);

  const setupDragSelection = (layer: { add(shape: { name: string }): void }) => {
    const pendingFieldCreation = new Konva.Rect({
      name: 'pending-field-creation',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      fill: 'rgba(24, 160, 251, 0.3)',
    });
    layer.add(pendingFieldCreation);
    setPendingFieldCreation(pendingFieldCreation);
  };

  return <div id={pageId} />;
}
