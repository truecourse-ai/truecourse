
// FP shape f8386853394f: React.forwardRef with cn() and spread props — no type mismatch
declare function cn(...args: (string | undefined | null | boolean)[]): string;

const BrandingPreviewPanel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'compact' }
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="region"
    className={cn('space-y-4 rounded-lg border bg-background p-6', className)}
    {...props}
  />
));
BrandingPreviewPanel.displayName = 'BrandingPreviewPanel';
