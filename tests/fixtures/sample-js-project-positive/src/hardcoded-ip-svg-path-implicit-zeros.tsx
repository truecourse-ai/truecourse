/**
 * Positive fixture for security/deterministic/hardcoded-ip.
 *
 * Second SVG variant: when the moveto command is followed by a long
 * coordinate run that contains an implicit-zero sequence like
 * `2.7.6.5` (SVG path syntax parses that as `2.7 0.6 0.5`), the
 * four-octet-shaped substring is bordered by spaces — not by `.` —
 * so the existing "adjacent dot" skip does not catch it. The rule
 * should recognise the surrounding string as SVG path data instead
 * of treating the run as a real IPv4 address.
 */

export function CompanyLogo(): JSX.Element {
  return (
    <svg viewBox="0 0 320 320" xmlns="http://www.w3.org/2000/svg">
      <path
        fill="currentColor"
        d="M79.2 167.7v25.7c.2 20.3 1.3 31.4 8.6 38.8 7.4 7.3 18.5 8.4 38.8 8.6h67c20.3-.2 31.5-1.3 38.8-8.6 8.7-8.6 8.7-22.5 8.7-50.3v-14.2l-14.4 15.5a12.3 12.3 0 0 0-3 5.5c0 10 0 17.1-.7 22.5v.3l-.1.4c-.8 6.1-2.1 7.5-2.7 8-.5.6-2 1.9-8 2.7h-.4v.1h-.5c-3.1.4-6.7.6-11 .7l-10 .6c-2.7.2-5.4 1.3-7.5 3.2l-15 13.6h-15.6l-15-14c-2-1.9-4.5-3-7.2-3.3h-3.3c-8.1 0-14-.3-18.6-.9-6.1-.8-7.5-2-8-2.6-.6-.6-1.9-2-2.7-8v-.3l-.1-.2v-.5a168 168 0 0 1-.8-18.1v-2a12.3 12.3 0 0 0-3.3-7.8l-14-15.4Z"
      />
      <path
        fill="currentColor"
        d="m33.4 132.6 12.3-13.3c2.8-3 4.6-7 5-11 0-7 .1-12.9.4-18.1v-.7l1-12.3c1.5-10.6 4-15.1 7-18.1 3-3 7.5-5.5 18.1-7 3.7-.4 7.8-.8 12.5-1h.3c5.4-.3 11.6-.4 18.7-.4 4.3-.4 8.4-2.3 11.5-5.3l12.4-12h-7.1c-43.4 0-65.1 0-78.6 13.5C33.4 60.3 33.4 82 33.4 125.5v7.1Z"
      />
    </svg>
  );
}
