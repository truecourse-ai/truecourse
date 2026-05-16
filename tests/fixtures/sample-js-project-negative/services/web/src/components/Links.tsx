/**
 * External link components.
 */

import React from 'react';

export function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  // VIOLATION: security/deterministic/link-target-blank
  return <a href={href} target="_blank">{children}</a>;
}

export function DocumentationLink() {
  // VIOLATION: security/deterministic/link-target-blank
  return <a href="https://docs.example.com" target="_blank">Documentation</a>;
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
export function buildLinkUrl(base: string, path: string) {
  return base + path;
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
export function sanitizeLinkText(text: string) {
  return text.replace(/[<>]/g, '');
}
