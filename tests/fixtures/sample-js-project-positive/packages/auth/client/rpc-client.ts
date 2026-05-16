// Hono RPC chain — bracket consistency when sibling keys require brackets (colon-prefixed)
declare const apiClient: any;

async function getUserById(userId: string) {
  // ':userId' requires bracket notation; 'user' uses brackets for chain consistency
  const res = await apiClient['user'][':userId'].$get({ param: { ':userId': userId } });
  return res.json();
}

async function getOrganisationMember(orgId: string, memberId: string) {
  const res = await apiClient['organisation'][':orgId']['members'][':memberId'].$get({
    param: { ':orgId': orgId, ':memberId': memberId },
  });
  return res.json();
}


// 'email-password' is a Hono RPC typed route key accessed via bracket notation — a framework API pattern, not a magic string.
declare const authApiClient: Record<string, Record<string, { $post: (args: { json: unknown }) => Promise<Response> }>>;

export async function signInWithPassword(email: string, password: string) {
  const response = await authApiClient['email-password']['sign-in'].$post({ json: { email, password } });
  if (!response.ok) {
    throw new Error('Sign-in failed');
  }
  return response.json();
}

export async function registerWithPassword(email: string, password: string) {
  const response = await authApiClient['email-password']['sign-up'].$post({ json: { email, password } });
  if (!response.ok) {
    throw new Error('Registration failed');
  }
  return response.json();
}



// magic-string: 'password-reset' flow name string repeated 3+ times without a named constant
declare function logAuthEvent(flow: string, step: string): void;
declare function getFlowConfig(flow: string): { maxAttempts: number };
declare function trackFlowStart(flow: string, userId: string): void;

export function initiatePasswordReset(userId: string): void {
  trackFlowStart('password-reset', userId);
  logAuthEvent('password-reset', 'initiated');
  const config = getFlowConfig('password-reset');
  if (config.maxAttempts <= 0) {
    throw new Error('Password reset flow is disabled');
  }
}

