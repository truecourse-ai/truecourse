
// --- redundant-type-alias FP: exported public API alias decoupling consumers from internal type ---
interface BrandingContextValue {
  brandName: string;
  brandColor: string;
  logoUrl?: string;
  showFooter: boolean;
}

declare function useContext<T>(ctx: unknown): T;
declare const BrandingContext: unknown;

export const useBranding = () => useContext<BrandingContextValue>(BrandingContext);

// Exported alias: decouples email template consumers from internal BrandingContextValue
export type BrandingSettings = BrandingContextValue;
