/**
 * Paraphrased true-bug for code-quality/deterministic/filename-class-mismatch.
 *
 * The filename and the default export's topic genuinely diverge — no
 * `<Topic><Role>` relationship between them, just a renamed file or a
 * copy-paste that was never cleaned up. Importers see a path that says
 * one thing and a symbol that says another.
 */

// VIOLATION: code-quality/deterministic/filename-class-mismatch
export default class BillingDashboard {
  readonly id = 'billing-dashboard';
}
