
// FP shape: Promise.all([renderEmail(template, opts), renderEmail(template, {...opts, plainText: true})]) — valid overloaded parallel calls
declare function renderEmailTemplate(
  template: { subject: string; body: string },
  opts: { locale: string; plainText?: boolean }
): Promise<string>;

declare const notificationTemplate: { subject: string; body: string };
declare const emailOpts: { locale: string };

async function renderEmailVariants() {
  const [htmlEmail, plainEmail] = await Promise.all([
    renderEmailTemplate(notificationTemplate, emailOpts),
    renderEmailTemplate(notificationTemplate, { ...emailOpts, plainText: true }),
  ]);

  return { html: htmlEmail, plain: plainEmail };
}
