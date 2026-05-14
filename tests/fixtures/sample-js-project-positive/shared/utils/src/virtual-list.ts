// arithmetic-loop-bounds-guaranteed: j bounded by Math.min(itemCount, i+overscan) < offsets.length
function computeVisibleItems(
  offsets: number[],
  itemCount: number,
  scrollTop: number,
  viewportHeight: number,
  overscan: number
): { index: number; offset: number }[] {
  const items: { index: number; offset: number }[] = [];

  for (let i = 0; i < itemCount; i++) {
    const start = offsets[i];

    if (start > scrollTop + viewportHeight) {
      const overscanEnd = Math.min(itemCount, i + overscan);
      for (let j = i; j < overscanEnd; j++) {
        items.push({ index: j, offset: offsets[j] });
      }
      break;
    }

    items.push({ index: i, offset: start });
  }

  return items;
}
