// SVG path d coordinates with decimal sequences that match IP regex — geometric path data, not network addresses
type IconProps = React.SVGAttributes<SVGSVGElement>;

export function BrandIcon({ className, ...props }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 84 84" className={className} {...props}>
      <g fill="currentColor">
        <path d="M35.53 12.152c-.968.879-2.038 1.91-3.261 3.118a4.55 4.55 0 0 1-2.722.97l-4.098.079 1.194-1.194C33.883 7.885 37.502 4.265 42 4.265s8.118 3.62 15.357 10.86l1.192 1.192-3.957-.075a4.55 4.55 0 0 1-3.004-1.209l-2.373-2.194" />
      </g>
    </svg>
  );
}
