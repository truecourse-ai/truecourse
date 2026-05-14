
// --- FP shape: Remix default page component returning JSX; trivially inferred. Framework convention ---
declare const Trans: (props: { children: unknown }) => unknown;
declare const Link: (props: { to: string; children: unknown }) => unknown;

export default function SignatureDisclosure() {
  return (
    <div>
      <article>
        <h1>Signature Disclosure</h1>
        <p>By using our electronic signature service, you agree to the terms outlined here.</p>
        <p>
          <Link to="/signup">Sign up</Link> to get started.
        </p>
      </article>
    </div>
  );
}
