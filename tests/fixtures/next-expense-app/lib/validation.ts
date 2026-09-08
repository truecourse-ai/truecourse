import { CATEGORIES, type Category, type ExpenseInput, type Filters } from './expenses';

export class InputError extends Error {}
export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31') return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function parseExpense(value: unknown): ExpenseInput & { amountCents: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('An expense must be a JSON object.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['description', 'amount', 'category', 'date', 'notes'].includes(key))) throw new InputError('The expense contains an unsupported field.');
  if (typeof input.description !== 'string' || !input.description.trim() || input.description.trim().length > 120) throw new InputError('Description must contain 1 to 120 characters.');
  if (typeof input.amount !== 'string' || !/^\d{1,7}(\.\d{1,2})?$/.test(input.amount)) throw new InputError('Amount must be a decimal string with up to two decimal places.');
  const [whole, fraction = ''] = input.amount.split('.');
  const amountCents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (amountCents < 1 || amountCents > 999999999) throw new InputError('Amount must be between $0.01 and $9,999,999.99.');
  if (!CATEGORIES.includes(input.category as Category)) throw new InputError('Choose a valid category.');
  if (!validDate(input.date)) throw new InputError('Enter a valid expense date between 1900 and 9999.');
  if (typeof input.notes !== 'string' || input.notes.length > 1000) throw new InputError('Notes must be a string of at most 1,000 characters.');
  return { description: input.description.trim(), amount: input.amount, amountCents, category: input.category as Category, date: input.date, notes: input.notes.trim() };
}
export function parseQuery(params: URLSearchParams): Filters & { page: number } {
  const q = (params.get('q') ?? '').trim();
  const category = params.get('category') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const pageText = params.get('page') ?? '1';
  if (q.length > 120) throw new InputError('Search must be at most 120 characters.');
  if (category && !CATEGORIES.includes(category as Category)) throw new InputError('Choose a valid category.');
  if ((from && !validDate(from)) || (to && !validDate(to))) throw new InputError('Enter valid filter dates.');
  if (from && to && from > to) throw new InputError('From date must be on or before To date.');
  if (!/^[1-9]\d*$/.test(pageText) || !Number.isSafeInteger(Number(pageText))) throw new InputError('Page must be a positive integer.');
  return { q, category, from, to, page: Number(pageText) };
}
export function parseId(text: string): number {
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) throw new InputError('Expense ID must be a positive integer.');
  return Number(text);
}
