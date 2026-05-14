// SVG path d attribute with numeric coordinates that look like IP octets — geometric path data, not IPs
type NavIconProps = React.SVGAttributes<SVGSVGElement>;

export function NavIcon({ className, ...props }: NavIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 84 84" className={className} {...props}>
      <g fill="currentColor">
        <path d="M38.91 23.96l-2.747 2.33a2.9 2.9 0 0 1-1.747.689l-4.597.214 2.397-2.397c4.627-4.627 6.94-6.94 9.815-6.94s5.188 2.313 9.815 6.94l2.383 2.382-4.662-.202a2.9 2.9 0 0 1-1.773-.703l-2.074-1.789" />
        <path d="M61.023 39.995c-.785-.992-1.911-2.163-3.542-3.803a2.9 2.9 0 0 1-.44-1.426l-.202-4.977 2.369 2.368c4.627 4.627 6.94 6.94 6.94 9.815s-2.313 5.188-6.94 9.815l-2.382 2.381.23-4.757" />
      </g>
    </svg>
  );
}
