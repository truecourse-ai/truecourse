export function deepNested_2537e293(x: number): number {
  if (x > 0) {
    for (let i = 0; i < x; i++) {
      if (i % 2 === 0) {
        while (i < 100) {
          if (i === 50) {
            return i;
          }
          i++;
        }
      }
    }
  }
  return 0;
}
