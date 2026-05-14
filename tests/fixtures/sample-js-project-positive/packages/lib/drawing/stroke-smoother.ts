
const VELOCITY_SMOOTHING = 0.5;

function smoothVelocity(currentVelocity: number, lastVelocity: number): number {
  return VELOCITY_SMOOTHING * currentVelocity + (1 - VELOCITY_SMOOTHING) * lastVelocity;
}
