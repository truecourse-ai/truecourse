/**
 * Security violations that require TSX (JSX elements).
 */

// VIOLATION: security/deterministic/disabled-auto-escaping
export function DisabledAutoEscapingJsx({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

// VIOLATION: security/deterministic/disabled-resource-integrity
export function DisabledResourceIntegrity() {
  return <script src="https://cdn.example.com/lib.js" />;
}

// VIOLATION: security/deterministic/mixed-content
export function MixedContentComponent() {
  return <img src="http://cdn.example.com/image.png" alt="Insecure" />;
}
