// SVG path d attribute with decimal coordinate sequences that match IP-address regex — geometric data only
type BackgroundProps = React.SVGAttributes<SVGSVGElement>;

export function HeroBackground({ ...props }: BackgroundProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 900" fill="none" {...props}>
      <path
        stroke="url(#g)"
        strokeWidth="0.7"
        d="M708 195.8c.4-1.5.8-3.5 2-4.7 2-2 3 2.5 3.5 3.7.6 2 1.2 4.2 2.1 6.1 1.8 2.3 3.2-2.1 3.6-3.3.8-1.9 1.4-4.5 3-5.9 1.5-1.4 2.6 3.8 2.9 4.5"
      />
    </svg>
  );
}
