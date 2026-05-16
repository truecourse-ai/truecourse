
declare const users: Array<{ id: string; email: string; role: string }>;
declare const activeUser: { id: string } | null;

function getActiveUserIndex() {
  const activeUserIndex = users.findIndex((u) => u.id === activeUser?.id);
  return activeUserIndex;
}



declare const selectedItems: Array<{ id: string; name: string }>;
declare const targetId: string;

function getSelectedItemById(id: string) {
  const item = selectedItems.find(({ id: itemId }) => itemId === id);
  return item?.name ?? 'Untitled';
}

const label = getSelectedItemById(targetId);



declare function validateTextInput(text: string, rules: { minLength?: number; maxLength?: number }, strict: boolean): string[];
declare const inputText: string;
declare const fieldRules: { minLength?: number; maxLength?: number };

function getValidationMessages() {
  const validationMessages = validateTextInput(inputText, fieldRules, true);
  return {
    required: validationMessages.filter((msg) => msg.includes('required')),
    tooLong: validationMessages.filter((msg) => msg.includes('character limit')),
  };
}



// instanceof-narrowed-before-access: catch(err) narrowed with instanceof Error before .message; ternary handles non-Error
declare function enableFeatureFlag(flagName: string): Promise<void>;
declare function showErrorBanner(msg: string): void;

async function activateFeature(flagName: string): Promise<void> {
  try {
    await enableFeatureFlag(flagName);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to enable feature';
    showErrorBanner(message);
  }
}



// narrowed-via-parse-wrap-utility: catch(err) wrapped via AppError.parseError; all accesses on typed result
declare const AppError: { parseError(e: unknown): { code: string; message: string } };
declare function updateTeamSettings(teamId: string, settings: Record<string, unknown>): Promise<void>;
declare function showToast(msg: string, type: 'error' | 'success'): void;

async function handleTeamSettingsUpdate(teamId: string, settings: Record<string, unknown>): Promise<void> {
  try {
    await updateTeamSettings(teamId, settings);
    showToast('Team settings updated', 'success');
  } catch (err) {
    const error = AppError.parseError(err);
    showToast(error.message, 'error');
  }
}



// underscore-prefixed-intentional-discard: catch(_err) prefixed with underscore indicating intentionally unused
declare function disableAuthenticatorApp(userId: string, code: string): Promise<void>;
declare function showToast(msg: string, type: 'error' | 'success'): void;

async function handleDisableAuthenticator(userId: string, code: string): Promise<void> {
  try {
    await disableAuthenticatorApp(userId, code);
    showToast('Authenticator app disabled', 'success');
  } catch (_err) {
    showToast('Invalid code. Please try again.', 'error');
  }
}



// catch-variable-never-accessed: catch(err) never accessed; block shows fixed toast without touching err
declare function updateUserProfile(userId: string, data: Record<string, unknown>): Promise<void>;
declare function showToast(msg: string, type: 'error' | 'success'): void;

async function handleProfileUpdate(userId: string, data: Record<string, unknown>): Promise<void> {
  try {
    await updateUserProfile(userId, data);
    showToast('Profile updated successfully', 'success');
  } catch (err) {
    showToast('Failed to update profile. Please try again.', 'error');
  }
}
