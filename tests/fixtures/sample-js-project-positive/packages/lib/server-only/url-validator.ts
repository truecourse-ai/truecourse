// http:// prefix used purely to construct a parseable URL for hostname extraction — no network communication
declare function isBlockedUrl(url: string): boolean;

function resolveIpv4MappedHost(normalizedHost: string): boolean {
  const v4Mapped = normalizedHost.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);

  if (v4Mapped) {
    // Recursive call with a synthetic URL so the URL constructor can parse the extracted IPv4 address.
    // The http:// scheme here is structural glue only; no HTTP request is made.
    return isBlockedUrl(`http://${v4Mapped[1]}`);
  }

  return false;
}
