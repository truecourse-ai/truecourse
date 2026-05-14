
declare const SNAP_THRESHOLD: number;

function computeSnapGuides(
  movingLeft: number,
  movingRight: number,
  movingTop: number,
  movingBottom: number,
  horizontal: Array<{ position: number }>,
  vertical: Array<{ position: number }>,
) {
  const horizontalGuides: number[] = [];
  const verticalGuides: number[] = [];

  for (const snap of horizontal) {
    if (Math.abs(movingTop - snap.position) <= SNAP_THRESHOLD) {
      horizontalGuides.push(snap.position);
    } else if (Math.abs(movingBottom - snap.position) <= SNAP_THRESHOLD) {
      horizontalGuides.push(snap.position);
    }
  }

  for (const snap of vertical) {
    if (Math.abs(movingLeft - snap.position) <= SNAP_THRESHOLD) {
      verticalGuides.push(snap.position);
    } else if (Math.abs(movingRight - snap.position) <= SNAP_THRESHOLD) {
      verticalGuides.push(snap.position);
    }
  }

  return { horizontalGuides, verticalGuides };
}
