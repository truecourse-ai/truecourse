// FP shape: function call with spread object where all properties match the typed parameter
interface ReportParams {
  envelope: { id: string; title: string };
  recipients: Array<{ id: string; email: string }>;
  locale: string;
}
declare function generateReportPdf(params: ReportParams): Promise<Buffer>;
declare const envelope: { id: string; title: string; recipients: Array<{ id: string; email: string }> };

async function exportReport(locale: string): Promise<Buffer> {
  return generateReportPdf({
    envelope,
    recipients: envelope.recipients,
    locale,
  });
}



// --- elseif-without-else shape: accumulator-add-on-match-only ---
// Snap field edges to alignment guides: add a guide only when edge is within
// threshold. No else needed — non-matching points simply contribute nothing.
declare const SNAP_THRESHOLD: number;
declare type SnapPoint = { position: number };

export function collectAlignmentGuides(
  movingTop: number,
  movingBottom: number,
  movingLeft: number,
  movingRight: number,
  horizontal: SnapPoint[],
  vertical: SnapPoint[],
): { horizontalGuides: number[]; verticalGuides: number[] } {
  const horizontalGuides: number[] = [];
  const verticalGuides: number[] = [];

  for (const snapPoint of horizontal) {
    if (Math.abs(movingTop - snapPoint.position) <= SNAP_THRESHOLD) {
      horizontalGuides.push(snapPoint.position);
    } else if (Math.abs(movingBottom - snapPoint.position) <= SNAP_THRESHOLD) {
      horizontalGuides.push(snapPoint.position);
    }
  }

  for (const snapPoint of vertical) {
    if (Math.abs(movingLeft - snapPoint.position) <= SNAP_THRESHOLD) {
      verticalGuides.push(snapPoint.position);
    } else if (Math.abs(movingRight - snapPoint.position) <= SNAP_THRESHOLD) {
      verticalGuides.push(snapPoint.position);
    }
  }

  return { horizontalGuides, verticalGuides };
}



// --- elseif-without-else shape: iteration-silent-skip ---
// Snap position to nearest guide: check top edge, then bottom edge, then center.
// Points that don't match any edge are silently skipped — missing else is intentional.
declare const FIELD_SNAP_THRESHOLD: number;
declare type FieldRect = { width: number; height: number };
declare type PositionSnapPoint = { position: number };

export function snapFieldPosition(
  newX: number,
  newY: number,
  rect: FieldRect,
  horizontal: PositionSnapPoint[],
  vertical: PositionSnapPoint[],
): { x: number; y: number; horizontalGuide?: number; verticalGuide?: number } {
  let snappedX = newX;
  let snappedY = newY;
  let horizontalGuide: number | undefined;
  let verticalGuide: number | undefined;

  const movingTop = newY;
  const movingBottom = newY + rect.height;
  const movingCenterY = newY + rect.height / 2;
  const movingLeft = newX;
  const movingRight = newX + rect.width;
  const movingCenterX = newX + rect.width / 2;

  for (const snapPoint of horizontal) {
    const distanceTop = Math.abs(movingTop - snapPoint.position);
    const distanceBottom = Math.abs(movingBottom - snapPoint.position);
    const distanceCenter = Math.abs(movingCenterY - snapPoint.position);
    if (distanceTop <= FIELD_SNAP_THRESHOLD) {
      snappedY = snapPoint.position;
      horizontalGuide = snapPoint.position;
      break;
    } else if (distanceBottom <= FIELD_SNAP_THRESHOLD) {
      snappedY = snapPoint.position - rect.height;
      horizontalGuide = snapPoint.position;
      break;
    } else if (distanceCenter <= FIELD_SNAP_THRESHOLD) {
      snappedY = snapPoint.position - rect.height / 2;
      horizontalGuide = snapPoint.position;
      break;
    }
  }

  for (const snapPoint of vertical) {
    const distanceLeft = Math.abs(movingLeft - snapPoint.position);
    const distanceRight = Math.abs(movingRight - snapPoint.position);
    const distanceCenter = Math.abs(movingCenterX - snapPoint.position);
    if (distanceLeft <= FIELD_SNAP_THRESHOLD) {
      snappedX = snapPoint.position;
      verticalGuide = snapPoint.position;
      break;
    } else if (distanceRight <= FIELD_SNAP_THRESHOLD) {
      snappedX = snapPoint.position - rect.width;
      verticalGuide = snapPoint.position;
      break;
    } else if (distanceCenter <= FIELD_SNAP_THRESHOLD) {
      snappedX = snapPoint.position - rect.width / 2;
      verticalGuide = snapPoint.position;
      break;
    }
  }

  return { x: snappedX, y: snappedY, horizontalGuide, verticalGuide };
}


// env() called with typed environment variable name strings — config lookup keys, not magic strings
declare function env(key: string): string | undefined;

function getMailerTransportConfig() {
  const host = env('MAILER_SMTP_HOST');
  const apiKey = env('MAILER_SMTP_APIKEY');
  if (!host || !apiKey) {
    throw new Error('MAILER_SMTP_HOST and MAILER_SMTP_APIKEY are required');
  }
  return {
    host,
    port: Number(env('MAILER_SMTP_PORT')) || 587,
    secure: env('MAILER_SMTP_SECURE') === 'true',
    auth: {
      user: env('MAILER_SMTP_APIKEY_USER') ?? 'apikey',
      pass: apiKey,
    },
  };
}



// PDFDocument.load() is a PDF library call — not a database operation, no transaction needed
declare const PDFLib: {
  PDFDocument: { load(data: Uint8Array): Promise<{ getForm(): { flatten(): void }; save(): Promise<Uint8Array> }> };
};

export async function flattenPdfFormFields(pdfBytes: Uint8Array): Promise<Uint8Array> {
  const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes);
  pdfDoc.getForm().flatten();
  return pdfDoc.save();
}



// magic-string: 'smtp-transport' config key repeated 3+ times without a named constant
declare function getConfig(key: string): string | undefined;
declare function logTransport(name: string, host: string): void;
declare function createTransport(name: string, opts: object): unknown;
declare function destroyTransport(name: string): void;

function initSmtpTransport() {
  logTransport('smtp-transport', getConfig('SMTP_HOST') ?? '');
  const transport = createTransport('smtp-transport', {
    host: getConfig('SMTP_HOST'),
    port: 587,
  });
  if (!transport) throw new Error('Failed to initialise mail transport');
  return transport;
}

function teardownSmtpTransport() {
  destroyTransport('smtp-transport');
}



// FP: PDFDocument.load() and pdfDoc.save()/legacyDoc.save() are PDF library calls.
// The rule incorrectly flags save() as an ORM write method needing a transaction.
declare const PDFLib: {
  PDFDocument: {
    load(data: Uint8Array): Promise<{ getForm(): { flatten(): void }; save(opts?: unknown): Promise<Uint8Array> }>;
  };
};

export async function flattenAndMergePdfs(pdfBytes: Uint8Array): Promise<Uint8Array> {
  const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes);
  pdfDoc.getForm().flatten();
  // Save intermediate to re-parse with a fresh PDFDocument for annotation baking
  const intermediateBytes = await pdfDoc.save({ useXRefStream: true });
  const legacyDoc = await PDFLib.PDFDocument.load(intermediateBytes);
  legacyDoc.getForm().flatten();
  return legacyDoc.save();
}

