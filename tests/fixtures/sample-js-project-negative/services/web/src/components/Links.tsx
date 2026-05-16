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
