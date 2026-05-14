
// error.status === 401 is the standard HTTP Unauthorized status check
declare function isRouteErrorResponse(err: unknown): err is { status: number; data: { type: string; email?: string } };
declare const error: unknown;

function EmbedErrorBoundary() {
  if (isRouteErrorResponse(error)) {
    if (error.status === 401 && error.data.type === 'embed-authentication-required') {
      return { component: 'EmbedAuthRequired', email: error.data.email };
    }

    if (error.status === 403 && error.data.type === 'embed-paywall') {
      return { component: 'EmbedPaywall' };
    }
  }

  return { component: 'GenericError' };
}
