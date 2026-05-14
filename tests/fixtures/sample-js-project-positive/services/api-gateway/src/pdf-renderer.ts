
// FP shape: path.join with process.cwd() and static file path strings — types match
import path from 'path';
import fs from 'fs';

function loadBrandingAsset(): Buffer {
  const assetPath = path.join(process.cwd(), 'public/assets/brand-logo.png');
  return fs.readFileSync(assetPath);
}

function loadTermsDocument(): Buffer {
  const termsPath = path.join(process.cwd(), 'public/legal/terms.pdf');
  return fs.readFileSync(termsPath);
}



// --- expression-complexity shape: destructured-parameter-lists ---
// renderGenericTextField accepts a large destructured options object.
// Multiple parameters with defaults is idiomatic for renderer functions.
declare const Konva: {
  Text: new (opts: unknown) => { id: string };
  Layer: new (opts: unknown) => { findOne: (sel: string) => unknown };
};

export const renderGenericTextField = ({
  field,
  pageWidth,
  pageHeight,
  mode = 'edit',
  pageLayer,
  translations,
}: {
  field: { id: string; type: string; fieldMeta?: unknown; renderId: string };
  pageWidth: number;
  pageHeight: number;
  mode?: 'edit' | 'view';
  pageLayer: { findOne: (sel: string) => unknown };
  translations?: Record<string, string>;
}) => {
  const fieldTypeName = translations?.[field.type] || field.type;
  const fieldText =
    pageLayer.findOne(`#${field.renderId}-text`) ||
    new Konva.Text({
      id: `${field.renderId}-text`,
      name: 'field-text',
    });
  return { fieldTypeName, fieldText };
};

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;


// FP shape: fs.readFileSync(...).toString('base64') — valid Buffer method chain; no type mismatch
import fs from 'fs';
import path from 'path';

export function loadTemplateAsBase64(templateName: string): string {
  const templatePath = path.join(process.cwd(), 'templates', templateName);
  return fs.readFileSync(templatePath).toString('base64');
}

export function loadBrandLogoAsBase64(): string {
  const logoPath = path.join(process.cwd(), 'public', 'assets', 'logo.png');
  return fs.readFileSync(logoPath).toString('base64');
}



// FP shape: unwrappedNode.destroy() is a Yoga/layout DOM lifecycle call, not a
// database write — the rule should not flag this as a missing-transaction.
declare const createYogaNode: (opts: Record<string, unknown>) => { id: string; calculateLayout: () => void };
declare const computeLayoutTree: (node: unknown) => { width: number; height: number; left: number; top: number };

export function renderFieldsLayout(opts: Record<string, unknown>): { width: number; height: number } {
  let layoutNode: ReturnType<typeof createYogaNode> | null = createYogaNode(opts);

  layoutNode.calculateLayout();
  const result = computeLayoutTree(layoutNode);

  // DOM lifecycle: destroy() releases native memory, not a DB write
  layoutNode.destroy();
  layoutNode = null;

  return result;
}

