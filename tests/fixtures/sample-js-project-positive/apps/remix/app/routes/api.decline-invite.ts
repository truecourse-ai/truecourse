
// 'InvalidLink' as const in a return object — typed discriminant constant in loader response
async function declineInviteLoader(params: { token?: string }) {
  const { token } = params;

  if (!token) {
    return {
      state: 'InvalidLink',
    } as const;
  }

  return { state: 'valid', token } as const;
}
