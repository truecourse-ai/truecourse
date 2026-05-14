
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
