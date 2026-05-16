
declare class SamplePoint {
  static fromPointerEvent(event: PointerEvent, dpi: number): SamplePoint;
  distanceTo(other: SamplePoint): number;
}

declare const canvas: HTMLCanvasElement;

function handlePointerMove(event: PointerEvent, dpi: number, lastPoint: SamplePoint): SamplePoint | null {
  const point = SamplePoint.fromPointerEvent(event, dpi);

  if (point.distanceTo(lastPoint) > 5) {
    return point;
  }

  return null;
}



declare class InputPoint {
  static fromPointerEvent(event: PointerEvent, dpi: number): InputPoint;
}

const POINTER_DPI = 2;

class PointerInputHandler {
  private readonly DPI = POINTER_DPI;
  private isTracking = false;

  private onPointerUp(event: PointerEvent): void {
    this.isTracking = false;
    const point = InputPoint.fromPointerEvent(event, this.DPI);
    this.finalizeInput(point);
  }

  private finalizeInput(point: InputPoint): void {
    // no-op in fixture
  }
}



declare class TracePoint {
  static fromMouseEvent(event: MouseEvent, dpi: number): TracePoint;
}

const TRACE_DPI = 2;

class MouseInputHandler {
  private readonly DPI = TRACE_DPI;
  private isPressed = false;

  private onMouseMove(event: MouseEvent): void {
    if (!this.isPressed) return;
    const point = TracePoint.fromMouseEvent(event, this.DPI);
    this.recordPoint(point);
  }

  private recordPoint(point: TracePoint): void {
    // no-op in fixture
  }
}
