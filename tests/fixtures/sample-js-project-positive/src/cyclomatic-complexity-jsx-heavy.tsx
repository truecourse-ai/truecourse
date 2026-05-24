/**
 * JSX-heavy form component. The function body itself has trivial
 * control flow (a couple of state hooks and a single return), but the
 * returned JSX uses many `&&` / `?:` operators for conditional
 * rendering. Counting those as cyclomatic decision points inflates
 * complexity to >10 even though the imperative branching is small.
 */

import { useState } from 'react';

type LoginPanelProps = {
  initialEmail?: string;
  googleEnabled?: boolean;
  microsoftEnabled?: boolean;
  oidcEnabled?: boolean;
  oidcLabel?: string;
  showPasskey?: boolean;
  showCaptcha?: boolean;
  showTwoFactor?: boolean;
  twoFactorMode?: 'totp' | 'backup';
  bannerText?: string;
};

export function LoginPanel({
  initialEmail,
  googleEnabled,
  microsoftEnabled,
  oidcEnabled,
  oidcLabel,
  showPasskey,
  showCaptcha,
  showTwoFactor,
  twoFactorMode,
  bannerText,
}: LoginPanelProps): JSX.Element {
  const [email, setEmail] = useState<string>(initialEmail ?? '');
  const [submitting, setSubmitting] = useState<boolean>(false);

  return (
    <form>
      {bannerText && <div className="banner">{bannerText}</div>}
      <input value={email} onChange={(e) => setEmail(e.target.value)} />
      {googleEnabled && <button type="button">Google</button>}
      {microsoftEnabled && <button type="button">Microsoft</button>}
      {oidcEnabled && <button type="button">{oidcLabel ?? 'OIDC'}</button>}
      {showPasskey && <button type="button">Passkey</button>}
      {showCaptcha && <div className="captcha">captcha here</div>}
      {showTwoFactor && twoFactorMode === 'totp' && <input placeholder="One-time code" />}
      {showTwoFactor && twoFactorMode === 'backup' && <input placeholder="Backup code" />}
      {!showTwoFactor && (
        <button type="submit" disabled={submitting}>
          {submitting ? 'Signing in' : 'Sign in'}
        </button>
      )}
    </form>
  );
}
