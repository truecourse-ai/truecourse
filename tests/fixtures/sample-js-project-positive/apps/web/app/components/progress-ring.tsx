
// 2 * Math.PI * 16 computes the circumference of a circle with radius 16 for an SVG progress ring
declare const currentStep: number;
declare const totalSteps: number;

const RADIUS = 16;
const circumference = 2 * Math.PI * RADIUS;

const progressRingProps = {
  r: RADIUS,
  strokeDasharray: 2 * Math.PI * 16,
  strokeDashoffset: 2 * Math.PI * 16 * (1 - currentStep / totalSteps),
};
