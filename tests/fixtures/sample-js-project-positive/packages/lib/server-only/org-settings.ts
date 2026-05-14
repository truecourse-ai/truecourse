
// Boolean feature flag comparison for org settings validation — configuration, not secret
declare const AppError: new (code: string, opts: any) => Error;
declare const AppErrorCode: { INVALID_BODY: string };

interface SignatureSettings {
  typedSignatureEnabled: boolean;
  uploadSignatureEnabled: boolean;
  drawSignatureEnabled: boolean;
}

export function validateSignatureSettings(settings: SignatureSettings) {
  if (
    settings.typedSignatureEnabled === false &&
    settings.uploadSignatureEnabled === false &&
    settings.drawSignatureEnabled === false
  ) {
    throw new AppError(AppErrorCode.INVALID_BODY, {
      message: 'At least one signature type must be enabled',
    });
  }
}
