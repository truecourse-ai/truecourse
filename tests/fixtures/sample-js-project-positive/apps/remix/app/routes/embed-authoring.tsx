
// Array length and boolean config flag comparisons — UI/configuration values, not secrets
declare const enum SignatureFormat { DRAW = 'DRAW', TYPE = 'TYPE', UPLOAD = 'UPLOAD' }

interface EmbedConfig { signatureFormats?: SignatureFormat[]; externalId?: string; }

function deriveSignatureSettings(config: EmbedConfig) {
  const formats = config.signatureFormats ?? [];

  return {
    drawEnabled: formats.length === 0 || formats.includes(SignatureFormat.DRAW),
    typedEnabled: formats.length === 0 || formats.includes(SignatureFormat.TYPE),
    uploadEnabled: formats.length === 0 || formats.includes(SignatureFormat.UPLOAD),
  };
}



// Array length check to derive config flag — not a secret comparison
declare const enum DrawMode { FREEHAND = 'FREEHAND', STRAIGHT = 'STRAIGHT' }

function deriveAnnotationSettings(drawModes: DrawMode[]) {
  const typedAnnotationEnabled = drawModes.length === 0 || drawModes.includes(DrawMode.FREEHAND);
  const straightLineEnabled = drawModes.length === 0 || drawModes.includes(DrawMode.STRAIGHT);

  return { typedAnnotationEnabled, straightLineEnabled };
}



// signatureTypes.length === 0 for upload config flag — array length check on configuration
declare const enum SignatureMode { DRAW = 'DRAW', TYPE = 'TYPE', UPLOAD = 'UPLOAD' }

interface DocumentConfig { signatureModes?: SignatureMode[]; }

function resolveUploadEnabled(config: DocumentConfig): boolean {
  const modes = config.signatureModes ?? [];
  return modes.length === 0 || modes.includes(SignatureMode.UPLOAD);
}
