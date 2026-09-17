/**
 * The wind made visible: a few short streaks leaving the cursor toward the
 * boat, running along as time passes, fading with distance and with how much
 * of the wind still reaches. Returns whether anything was drawn.
 */
export function drawWind(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  t: number,
  reach: number,
  color: string,
): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.hypot(dx, dy);
  const push = Math.max(0, 1 - d / reach);
  if (d <= 1 || push <= 0) return false;
  const ux = dx / d;
  const uy = dy / d;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const along = ((t * 140 + i * 23) % 70) + 8;
    const side = (i - 2) * 9;
    const sx = from.x + ux * along - uy * side;
    const sy = from.y + uy * along + ux * side;
    ctx.globalAlpha = 0.45 * push * (1 - along / 80);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + ux * 16, sy + uy * 16);
    ctx.stroke();
  }
  ctx.restore();
  return true;
}
