// True bug pattern: an application service hardcodes its production
// API base URL into source. This should be hoisted to an environment
// variable so the same code can target staging, prod, or a local
// instance without a redeploy.

export async function fetchInvoiceReport(invoiceId: string): Promise<unknown> {
  // VIOLATION: code-quality/deterministic/hardcoded-url
  const response = await fetch(`https://reports.acme-internal.prod/v2/invoices/${invoiceId}`);
  return response.json();
}
