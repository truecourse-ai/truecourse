import { InputError } from './validation';
export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function readBody(request: Request): Promise<unknown> {
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) throw new InputError('Send an application/json request body.');
  const text = await request.text();
  if (text.length > 16000) throw new InputError('Request body is too large.');
  try { return JSON.parse(text); } catch { throw new InputError('Request body is not valid JSON.'); }
}
export function apiError(error: unknown): Response {
  if (error instanceof InputError) return json({ error: error.message }, 400);
  console.error('Expense API failed:', error);
  return json({ error: 'Unable to access expenses. Please try again.' }, 500);
}
