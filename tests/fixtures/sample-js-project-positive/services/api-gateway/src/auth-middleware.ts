
// String split/filter to extract bearer token from authorization header
declare function getRequestHeader(name: string): string | null;

function extractBearerToken(authHeader: string | null): string | undefined {
  const [token] = (authHeader || '').split('Bearer ').filter((s) => s.length > 0);
  return token;
}

function validateRequestAuth(): string | undefined {
  const authorizationHeader = getRequestHeader('authorization');
  return extractBearerToken(authorizationHeader);
}
