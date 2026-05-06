/**
 * Email template file. The exported class has the role suffix `Template`
 * which the filename omits — `confirm-email.tsx` ↔ `ConfirmEmailTemplate`.
 * The filename-class-mismatch rule should NOT fire because dropping the
 * `Template` role suffix from the class produces `ConfirmEmail`, which
 * matches the filename.
 *
 * Mirrors documenso `packages/email/templates/confirm-email.tsx`.
 */

class ConfirmEmailTemplate {
  private readonly subject: string;
  constructor(subject: string) {
    this.subject = subject;
  }

  render(name: string): string {
    return `<h1>${this.subject}</h1><p>Hi ${name}, please confirm your email.</p>`;
  }
}

export default ConfirmEmailTemplate;
