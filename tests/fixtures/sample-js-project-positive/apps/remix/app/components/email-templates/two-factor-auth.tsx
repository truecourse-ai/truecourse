
// getAssetUrl() returns a string URL; Img accepts string for src — no type mismatch
declare function getAssetUrl(path: string): string;
declare function Img(props: { src: string; alt: string; className?: string }): any;
declare const brandingLogo: string | null;
declare const brandingEnabled: boolean;

function renderBrandingLogo() {
  if (brandingEnabled && brandingLogo) {
    return Img({ src: brandingLogo, alt: 'Brand Logo', className: 'mb-4 h-6' });
  }

  return Img({ src: getAssetUrl('/static/logo.png'), alt: 'App Logo', className: 'mb-4 h-6' });
}



// Shape: _(msg`text`) lingui translation call with template literal — types correct, no mismatch
declare function _<T>(msg: T): string;
declare function msg(strings: TemplateStringsArray, ...values: unknown[]): string;

export function getLocalizedLabels() {
  const sentLabel = _(msg`Sent`);
  const viewedLabel = _(msg`Viewed`);
  const signedLabel = _(msg`Signed`);
  const unknownLabel = _(msg`Unknown`);

  return { sentLabel, viewedLabel, signedLabel, unknownLabel };
}
