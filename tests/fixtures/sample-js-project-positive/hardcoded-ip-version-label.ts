/**
 * Positive fixture for security/deterministic/hardcoded-ip.
 *
 * Outline / step labels such as "step 2.1.1.1" share the four-octet shape
 * of an IPv4 literal: a single descriptive word followed by a dotted run
 * of small integers. These are hierarchical section identifiers, not
 * network addresses, so the rule must not fire on them.
 */

export function recordSteps(track: (label: string) => void): void {
  track("step 2.1.1.1");
  track("step 3.1.1.1");
  track("step 3.2.4.5");
}
