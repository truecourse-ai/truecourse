interface UserInput {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface FormattedUser {
  id: string;
  name: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export function formatUser(user: UserInput): FormattedUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    displayName: `${user.name} <${user.email}>`,
    createdAt: new Date(user.createdAt).toISOString(),
  };
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0] ?? '';
}



// FP shape: formatAmount(currency, rawAmount / 100) — standard formatting with arithmetic
declare function formatAmount(currency: string, amount: number): string;
declare const invoice: { currency: string; amountCents: number; taxCents: number };

function renderInvoiceTotals() {
  const subtotal = formatAmount(invoice.currency, invoice.amountCents / 100);
  const tax = formatAmount(invoice.currency, invoice.taxCents / 100);
  return { subtotal, tax };
}



// --- argument-type-mismatch FP: string array map for title-casing with charAt+slice ---
function toTitleCase(phrase: string): string {
  return phrase
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}



// --- argument-type-mismatch FP: CJS require() call in config file ---
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodePath = require('path');
const nodeFs = require('fs');

const configDir = nodePath.resolve(__dirname, 'config');
const configExists = nodeFs.existsSync(configDir);
