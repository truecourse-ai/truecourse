// SVG path d attribute with coordinate sequences that match IP-address regex — geometric data, not network addresses
type LogoProps = React.SVGAttributes<SVGSVGElement>;

export function BrandMark({ ...props }: LogoProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" {...props}>
      <path
        fill="currentColor"
        d="M132.6 33.4c-4.1 3.8-8.7 8.1-13.9 13.3-3.2 2.5-7.3 4-11.5 4l-17.4.4 5-5C125.7 15.2 141 0 160 0s34.4 15.3 65.1 46l5 5.1-16.7-.3c-4.7-.1-9.3-2-12.7-5.1l-10.1-9.3-2.8-2.6-.5-.5c-3.5-3.2-6.6-5.8-9.6-8-8.5-6.6-13.5-8-17.7-8-4.2 0-9.2 1.4-17.7 8-3 2.2-6.2 5-9.7 8v.1Z"
      />
    </svg>
  );
}
