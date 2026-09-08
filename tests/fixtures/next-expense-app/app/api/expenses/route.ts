import { createExpense, listExpenses } from '@/lib/store';
import { apiError, json, readBody } from '@/lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { return json(listExpenses(new URL(request.url).searchParams)); } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try { return json(createExpense(await readBody(request)), 201); } catch (error) { return apiError(error); }
}
