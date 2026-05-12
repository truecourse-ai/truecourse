// Positive fixture: filename intentionally diverges from exported names by project convention.
// Mode 1: deliberate abbreviated / suffix-dropped name. Route file exports a generic 'route' const
// instead of mirroring 'GetEnvelopeItemPdf' from the filename. This is a deliberate convention.
declare const buildRouteHandler: (path: string) => { path: string; handler: () => Promise<unknown> };

export const route = buildRouteHandler('/envelopes/:id/items/:itemId/pdf');

// Mode 1 (variant): an email template file convention where the redundant 'Template' suffix is
// dropped from the export name relative to the filename ('template-document-super-delete.tsx').
declare const renderEmail: (subject: string) => string;

export function DocumentSuperDelete(): string {
  return renderEmail('Document deleted');
}

// Mode 2: route-shim re-export. A Remix-style URL-segment file aliases a component whose name
// reflects its purpose rather than the URL path. Without runtime imports we model the upstream
// component with `declare const` and re-export it under its semantic name.
declare const BillingPage: () => { kind: 'page'; name: string };

export { BillingPage };
export default BillingPage;

// Mode 3: framework boilerplate. The file IS the router, exporting the configured app instance
// under a generic singleton name ('app'), not a class derived from the filename.
declare const createApp: () => { get: (path: string, handler: () => void) => void };

export const app = createApp();
app.get('/health', () => {
  // health probe
});

// Mode 3 (variant): patched third-party library re-exported under the library's own name.
declare const Konva: { Stage: new () => unknown; backend: string };

Konva.backend = 'skia';
export { Konva };
