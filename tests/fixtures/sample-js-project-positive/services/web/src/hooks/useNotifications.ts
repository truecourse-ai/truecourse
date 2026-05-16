/**
 * Notifications utility -- manages notification state.
 */

interface Notification {
  id: string;
  title: string;
  read: boolean;
}

export function createNotifications(userId: string): Notification[] {
  return [
    { id: '1', title: `Welcome ${userId}`, read: false },
  ];
}

export function markAsRead(notifications: readonly Notification[], id: string): Notification[] {
  return notifications.map((n) => n.id === id ? { ...n, read: true } : n);
}



// -- useOverlayPosition: client-only hook that computes overlay coords from a DOM anchor --

declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
declare function useState<T>(initial: T): [T, (v: T) => void];
declare function getBoundingRect(el: HTMLElement): { top: number; left: number; height: number; width: number };

const OVERLAY_ANCHOR_SELECTOR = '[data-overlay-anchor]';

interface OverlayCoords {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OverlayField {
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  anchorIndex: number;
}

export const useOverlayPosition = (field: OverlayField) => {
  const [coords, setCoords] = useState<OverlayCoords>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });

  const recalculate = useCallback(() => {
    const anchor = document.querySelector<HTMLElement>(
      `${OVERLAY_ANCHOR_SELECTOR}[data-anchor-index="${field.anchorIndex}"]`,
    );

    if (!anchor) {
      return;
    }

    const { top, left, height, width } = getBoundingRect(anchor);

    const overlayX = (field.positionX / 100) * width + left;
    const overlayY = (field.positionY / 100) * height + top;
    const overlayWidth = (field.width / 100) * width;
    const overlayHeight = (field.height / 100) * height;

    setCoords({ x: overlayX, y: overlayY, width: overlayWidth, height: overlayHeight });
  }, [field.anchorIndex, field.positionX, field.positionY, field.width, field.height]);

  useEffect(() => {
    recalculate();
  }, [recalculate]);

  useEffect(() => {
    const onResize = () => {
      recalculate();
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, [recalculate]);

  return coords;
};
