
// FP: 6-member event union required for cross-environment pointer handling — not reducible
declare type ReactMouseEvent = { clientX: number; clientY: number; type: string };
declare type ReactPointerEvent = { clientX: number; clientY: number; type: string; pointerId: number };
declare type ReactTouchEvent = { touches: TouchList; type: string };

export type GestureEventLike = {
  x: number;
  y: number;
  timestamp: number;
};

const isNativeTouchEvent = (
  event: ReactMouseEvent | ReactPointerEvent | ReactTouchEvent | MouseEvent | PointerEvent | TouchEvent,
): event is TouchEvent | ReactTouchEvent => {
  return 'touches' in event;
};

const isNativePointerEvent = (
  event: ReactMouseEvent | ReactPointerEvent | ReactTouchEvent | MouseEvent | PointerEvent | TouchEvent,
): event is PointerEvent | ReactPointerEvent => {
  return 'pointerId' in event;
};

export function extractCoordinates(
  event: ReactMouseEvent | ReactPointerEvent | ReactTouchEvent | MouseEvent | PointerEvent | TouchEvent,
): { x: number; y: number } {
  if (isNativeTouchEvent(event)) {
    const touch = event.touches[0];
    return { x: touch.clientX, y: touch.clientY };
  }
  const e = event as ReactMouseEvent | ReactPointerEvent | MouseEvent | PointerEvent;
  return { x: e.clientX, y: e.clientY };
}

export class GesturePoint implements GestureEventLike {
  public x: number;
  public y: number;
  public timestamp: number;

  constructor(
    event: ReactMouseEvent | ReactPointerEvent | ReactTouchEvent | MouseEvent | PointerEvent | TouchEvent,
    timestamp?: number,
  ) {
    const { x, y } = extractCoordinates(event);
    this.x = x;
    this.y = y;
    this.timestamp = timestamp ?? Date.now();
  }

  public distanceTo(other: GestureEventLike): number {
    return Math.sqrt((other.x - this.x) ** 2 + (other.y - this.y) ** 2);
  }

  public velocityFrom(previous: GesturePoint): number {
    const dt = this.timestamp - previous.timestamp;
    return dt > 0 ? this.distanceTo(previous) / dt : 0;
  }
}
