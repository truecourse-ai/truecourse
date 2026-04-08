const HTTP_NOT_FOUND = 404;
const HTTP_BAD_REQUEST = 400;
const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;
export function getStatusCodes(): { notFound: number; badRequest: number; created: number; noContent: number } {
  return { notFound: HTTP_NOT_FOUND, badRequest: HTTP_BAD_REQUEST, created: HTTP_CREATED, noContent: HTTP_NO_CONTENT };
}
export function validateEmail(email: string): boolean {
  return email.includes('@');
}
