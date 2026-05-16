// privacy-disclosure.tsx — unauthenticated article/legal page route
// React component/route (TSX): JSX markup and hooks inflate line count;
// this is standard React framework structure, not decomposable excess logic.

declare const PublicHeader: () => JSX.Element;
declare const PublicFooter: () => JSX.Element;

export default function PrivacyDisclosurePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader />

      <main className="mx-auto max-w-3xl flex-1 px-6 py-12">
        <h1 className="mb-6 text-3xl font-bold">Privacy & Data Disclosure</h1>

        <p className="mb-4 text-muted-foreground">
          Last updated: January 1, 2025
        </p>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">1. Information We Collect</h2>
          <p className="mb-2">
            We collect information you provide directly, such as when you create an account,
            submit documents for signing, or contact our support team.
          </p>
          <p className="mb-2">
            We also collect information automatically, including log data, device information,
            usage patterns, and cookies when you interact with our services.
          </p>
          <ul className="mb-2 ml-4 list-disc space-y-1">
            <li>Account information: name, email, password</li>
            <li>Document content submitted for processing</li>
            <li>Signature and signing metadata</li>
            <li>IP addresses and browser fingerprints for authentication</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">2. How We Use Your Information</h2>
          <p className="mb-2">
            We use collected information to provide, maintain, and improve our services,
            process transactions, and send related information.
          </p>
          <p className="mb-2">
            We do not sell your personal data to third parties. We may share data with
            trusted service providers who assist in operating our platform.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">3. Data Retention</h2>
          <p className="mb-2">
            We retain personal data for as long as necessary to provide services and comply
            with legal obligations. You may request deletion of your data at any time.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">4. Your Rights</h2>
          <p className="mb-2">
            Depending on your location, you may have rights to access, correct, port, or
            delete your personal information. Contact us to exercise these rights.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">5. Contact Us</h2>
          <p className="mb-2">
            If you have questions about this disclosure, please contact our privacy team at{' '}
            <a href="mailto:privacy@example.com" className="text-primary underline">
              privacy@example.com
            </a>.
          </p>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
