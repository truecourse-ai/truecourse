import { cn } from '@/lib/cn';

type Props = {
  src: string;
  alt: string;
  className?: string;
  /** Show a soft blue radial halo behind the image for a polished feel. */
  halo?: boolean;
};

/**
 * Thin wrapper around an illustration PNG. The PNGs are pre-normalized to
 * the page background color (#020915), so they bleed into the dark theme
 * without a visible edge. `halo` adds a subtle blue glow behind the image.
 */
export function Illustration({ src, alt, className, halo = true }: Props) {
  return (
    <div className={cn('relative', className)}>
      {halo && (
        <div className="bg-radial-glow pointer-events-none absolute -inset-x-12 -inset-y-8 -z-10 opacity-40 blur-3xl" />
      )}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className="relative block h-auto w-full"
      />
    </div>
  );
}
