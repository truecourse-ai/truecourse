/** OneDrive is not in simple-icons any more, so its cloud is drawn here in the same style. */
export function OneDriveIcon({
  className,
  x,
  y,
  size,
  color,
}: {
  className?: string;
  x?: number;
  y?: number;
  size?: number;
  color?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={color ?? 'currentColor'}
      aria-hidden="true"
      className={className}
      x={x}
      y={y}
      width={size}
      height={size}
    >
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  );
}
