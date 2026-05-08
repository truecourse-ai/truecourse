/**
 * External link components.
 */

import React from 'react';

// PascalCase React components are skipped by missing-boundary-types
// — return type (`JSX.Element`) is conventional and well-inferred.
// The rule keeps firing on plain camelCase exported helpers (see
// other negative fixtures).
export function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  // VIOLATION: security/deterministic/link-target-blank
  return <a href={href} target="_blank">{children}</a>;
}

export function DocumentationLink() {
  // VIOLATION: security/deterministic/link-target-blank
  return <a href="https://docs.example.com" target="_blank">Documentation</a>;
}
