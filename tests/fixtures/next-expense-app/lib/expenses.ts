export const CATEGORIES = ['Food & drink', 'Transport', 'Shopping', 'Bills', 'Health', 'Other'] as const;
export type Category = typeof CATEGORIES[number];
export type ExpenseInput = { description: string; amount: string; category: Category; date: string; notes: string };
export type Expense = Omit<ExpenseInput, 'amount'> & { id: number; amountCents: number; createdAt: string; updatedAt: string };
export type Filters = { q: string; category: string; from: string; to: string };
export type ExpenseList = { expenses: Expense[]; page: number; pageSize: number; totalPages: number; totalCount: number; filteredTotalCents: number; totalSpentCents: number };
export const EMPTY_FILTERS: Filters = { q: '', category: '', from: '', to: '' };
export const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export const dateLabel = (date: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
export function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function emptyExpense(): ExpenseInput { return { description: '', amount: '', category: 'Food & drink', date: today(), notes: '' }; }
