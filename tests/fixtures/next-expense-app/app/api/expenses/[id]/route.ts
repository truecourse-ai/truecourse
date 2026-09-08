import { deleteExpense, getExpense, updateExpense } from '@/lib/store';
import { apiError, json, readBody } from '@/lib/http';
import { parseId } from '@/lib/validation';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try { const expense = getExpense(parseId((await context.params).id)); return expense ? json(expense) : json({ error: 'Expense not found.' }, 404); } catch (error) { return apiError(error); }
}
export async function PUT(request: Request, context: Context) {
  try { const expense = updateExpense(parseId((await context.params).id), await readBody(request)); return expense ? json(expense) : json({ error: 'Expense not found.' }, 404); } catch (error) { return apiError(error); }
}
export async function DELETE(_request: Request, context: Context) {
  try { return deleteExpense(parseId((await context.params).id)) ? new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } }) : json({ error: 'Expense not found.' }, 404); } catch (error) { return apiError(error); }
}
