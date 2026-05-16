
// --- argument-type-mismatch shape: stdlib-and-third-party-api-calls (Object.values length check) ---
declare class ValidationError extends Error { constructor(code: string, opts: { message: string }); }

interface TeamSettings {
  displayName?: string;
  allowMemberInvites?: boolean;
  defaultRole?: string;
  notificationEmail?: string;
}

export function validateSettingsPayload(data: TeamSettings) {
  if (Object.values(data).length === 0) {
    throw new ValidationError('INVALID_BODY', {
      message: 'No settings to update',
    });
  }
  return data;
}
