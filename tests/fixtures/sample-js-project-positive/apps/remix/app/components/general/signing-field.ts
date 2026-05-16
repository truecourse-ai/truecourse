
// FP: void executeAuthProcedure({...}) inside useEffect body — intentional fire-and-forget.
// Not a void 0 case; the void operator discards the returned Promise.
declare function useEffect3(fn: () => void | (() => void), deps: unknown[]): void;
declare function executeAuthProcedure(opts: { onSubmit: (token: string) => Promise<void>; target: string }): Promise<void>;

declare const fieldType: string;
declare const localChoice: string;
declare const fieldInserted: boolean;
declare function onSign(authToken: string): Promise<void>;

useEffect3(() => {
  if (!fieldInserted && localChoice) {
    void executeAuthProcedure({
      onSubmit: async (token) => await onSign(token),
      target: fieldType,
    });
  }
}, [localChoice]);



// safe-value-pass-no-property-access: catch(err) only console.error(err) and fixed toast, then re-throw
declare function submitSigningField(fieldId: string, value: string): Promise<void>;
declare function showToast(msg: string, type: 'error' | 'success'): void;

async function handleFieldSubmit(fieldId: string, value: string): Promise<void> {
  try {
    await submitSigningField(fieldId, value);
  } catch (err) {
    console.error(err);
    showToast('Failed to submit field. Please try again.', 'error');
    throw err;
  }
}



// safe-value-pass-no-property-access: catch(error) only console.error(error) and fixed toast; no unsafe property access
declare function unlinkSocialAccount(provider: string): Promise<void>;
declare function showToast(msg: string, type: 'error' | 'success'): void;

async function handleUnlinkAccount(provider: string): Promise<void> {
  try {
    await unlinkSocialAccount(provider);
    showToast('Account unlinked successfully', 'success');
  } catch (error) {
    console.error(error);
    showToast('Failed to unlink account. Please try again.', 'error');
  }
}



// safe-value-pass-no-property-access: catch(e) only console.warn(e) passing e as a value; no property access
declare function getSessionStorageItem(key: string): string | null;
declare function setSessionStorageItem(key: string, value: string): void;

function readSessionValue(key: string): string | null {
  try {
    return getSessionStorageItem(key);
  } catch (e) {
    console.warn(e);
    return null;
  }
}

function writeSessionValue(key: string, value: string): void {
  try {
    setSessionStorageItem(key, value);
  } catch (e) {
    console.warn(e);
  }
}



// safe-value-pass-no-property-access: catch(err) only two console.error calls passing err as value; no property access
declare function renderSignerPage(signerId: string, pageIndex: number): Promise<string>;
declare const logger: { error(label: string, data: unknown): void };

async function getRenderedSignerPage(signerId: string, pageIndex: number): Promise<string | null> {
  try {
    return await renderSignerPage(signerId, pageIndex);
  } catch (err) {
    console.error('Render failed for signer', err);
    console.error('Page index', err);
    return null;
  }
}



// safe-value-pass-no-property-access: catch(err) only callback and fixed toast; err never property-accessed
declare function submitMultiSignCompletion(sessionId: string): Promise<void>;
declare const onSigningError: (() => void) | undefined;
declare function showToast(msg: string, type: 'error' | 'success'): void;

async function handleMultiSignSubmit(sessionId: string): Promise<void> {
  try {
    await submitMultiSignCompletion(sessionId);
  } catch (err) {
    onSigningError?.();
    showToast('Signing failed. Please try again.', 'error');
  }
}



// safe-value-pass-no-property-access: catch(err) passed to console.error as a value; rest shows fixed toast
declare function updateOrganisationMemberRole(orgId: string, memberId: string, role: string): Promise<void>;
declare function showToast(msg: string, type: 'error' | 'success'): void;

async function handleMemberRoleUpdate(orgId: string, memberId: string, role: string): Promise<void> {
  try {
    await updateOrganisationMemberRole(orgId, memberId, role);
    showToast('Member role updated successfully', 'success');
  } catch (err) {
    console.error(err);
    showToast('Failed to update member role. Please try again.', 'error');
  }
}



// narrowed-via-parse-wrap-utility: catch(err) wrapped via AppError.parseError; all accesses on typed parsed error
declare const AppError: { parseError(e: unknown): { code: string; message: string } };
declare function submitMultiSignAuth(sessionId: string, authData: Record<string, unknown>): Promise<void>;
declare function showToast(msg: string, type: 'error' | 'success'): void;

async function handleMultiSignAuth(sessionId: string, authData: Record<string, unknown>): Promise<void> {
  try {
    await submitMultiSignAuth(sessionId, authData);
  } catch (err) {
    const error = AppError.parseError(err);
    if (error.code === 'AUTH_FAILED') {
      showToast('Authentication failed. Please try again.', 'error');
    } else {
      showToast(error.message, 'error');
    }
  }
}
