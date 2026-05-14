
// FP: async function body with simple constructor call — not a complex expression
declare namespace Canvas {
  class Group {
    add(...items: unknown[]): this;
    toObject(): object;
  }
}

async function renderCertificateBranding() {
  const brandingGroup = new Canvas.Group();
  return brandingGroup.toObject();
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;



// shape: .then() callback is async to obtain arrayBuffer from a Promise-returning method; async is redundant but intentional — res.arrayBuffer() already returns a Promise
declare const baseUrl: string;

const loadFontData = async () => {
  const [primaryFont, fallbackFont] = await Promise.all([
    fetch(`${baseUrl}/fonts/primary.ttf`).then(async (res) => res.arrayBuffer()),
    fetch(`${baseUrl}/fonts/fallback.ttf`).then(async (res) => res.arrayBuffer()),
  ]);

  return { primaryFont, fallbackFont };
};



// Enum comparison for PDF rendering logic — no secret or credential involved
declare const enum FieldType { SIGNATURE = 'SIGNATURE', FREE_SIGNATURE = 'FREE_SIGNATURE', TEXT = 'TEXT' }
declare const fontCaveat: unknown;
declare const fontNoto: unknown;

interface RenderField { type: FieldType; }

export function selectFont(field: RenderField) {
  const isSignatureField = field.type === FieldType.SIGNATURE || field.type === FieldType.FREE_SIGNATURE;
  return isSignatureField ? fontCaveat : fontNoto;
}



// Enum comparison to classify document field type for PDF insertion — enum dispatch, not secret
declare const enum DocumentFieldType { SIGNATURE = 'SIGNATURE', FREE_SIGNATURE = 'FREE_SIGNATURE', DATE = 'DATE', TEXT = 'TEXT' }

interface PdfField { type: DocumentFieldType; page: number; positionX: number; positionY: number; }

export function isSignatureKind(field: PdfField): boolean {
  return field.type === DocumentFieldType.SIGNATURE || field.type === DocumentFieldType.FREE_SIGNATURE;
}
