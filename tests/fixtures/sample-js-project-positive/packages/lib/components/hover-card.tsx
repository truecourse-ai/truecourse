
declare const animate: (target: any, value: number, opts: any) => Promise<void>;
declare const cardX: { set: (v: number) => void };
declare const cardY: { set: (v: number) => void };
declare const sheenOpacity: any;
declare function setTrackMouse(v: boolean): void;

function onCardMouseMove(
  event: MouseEvent,
  centerX: number,
  centerY: number,
  boundary: number,
  trackMouse: boolean,
  timeoutRef: { current: number },
) {
  const offsetX = event.clientX - centerX;
  const offsetY = event.clientY - centerY;
  const distance = Math.sqrt(offsetX * offsetX + offsetY * offsetY);

  if (distance <= boundary && !trackMouse) {
    setTrackMouse(true);
  } else if (!trackMouse) {
    return;
  }

  cardX.set(offsetX);
  cardY.set(offsetY);

  clearTimeout(timeoutRef.current);
  timeoutRef.current = window.setTimeout(() => {
    void animate(cardX, 0, { duration: 2, ease: 'backInOut' });
    void animate(cardY, 0, { duration: 2, ease: 'backInOut' });
    void animate(sheenOpacity, 0, { duration: 2, ease: 'backInOut' });
    setTrackMouse(false);
  }, 1000);
}
