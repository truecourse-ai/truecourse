
declare function isPrivateUrl(url: string): boolean;

// IPv4-mapped IPv6 detection — /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i is ASCII digits and colons.
export function resolveIpv4MappedIpv6(normalizedHost: string): string | null {
  const v4Mapped = normalizedHost.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return v4Mapped ? v4Mapped[1] : null;
}



// Trailing dots normalization from hostname — /\.+$/ is ASCII literal, unicode flag adds nothing.
export function stripTrailingDots(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/, '');
}


// isInternalNetworkUrl — thin-server FP shape with multiple IP-range checks
declare const z_ipCheck: { string: () => { ip: () => { safeParse: (v: string) => { success: boolean } } } };

const ZIpAddress = z_ipCheck.string().ip();

/**
 * Determine if a URL resolves to a reserved/private network range.
 * Covers loopback, RFC-1918 private, link-local, and IPv6 ULA/link-local ranges.
 */
export const isInternalNetworkUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    const bare = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
    const normalized = bare.replace(/\.+$/, '');

    if (normalized === 'localhost' || normalized === 'localhost.localdomain') {
      return true;
    }

    const ipResult = ZIpAddress.safeParse(normalized);
    if (!ipResult.success) {
      return false;
    }

    // IPv6 loopback and unspecified.
    if (normalized === '::1' || normalized === '::') {
      return true;
    }

    // IPv4 unspecified.
    if (normalized === '0.0.0.0') {
      return true;
    }

    // IPv4 loopback 127.0.0.0/8.
    if (normalized.startsWith('127.')) {
      return true;
    }

    // RFC-1918 Class A: 10.0.0.0/8.
    if (normalized.startsWith('10.')) {
      return true;
    }

    // RFC-1918 Class C: 192.168.0.0/16.
    if (normalized.startsWith('192.168.')) {
      return true;
    }

    // Link-local IPv4: 169.254.0.0/16.
    if (normalized.startsWith('169.254.')) {
      return true;
    }

    // IPv6 link-local: fe80::/10.
    if (normalized.startsWith('fe80:')) {
      return true;
    }

    // IPv6 ULA: fc00::/7 (fc and fd prefixes).
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
      return true;
    }

    // RFC-1918 Class B: 172.16.0.0/12.
    if (normalized.startsWith('172.')) {
      const second = parseInt(normalized.split('.')[1] ?? '0', 10);
      if (second >= 16 && second <= 31) {
        return true;
      }
    }

    // IPv4-mapped IPv6 address: ::ffff:<ipv4>.
    const v4MappedMatch = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (v4MappedMatch) {
      return isInternalNetworkUrl(`http://${v4MappedMatch[1]}`);
    }

    return false;
  } catch {
    return false;
  }
};
