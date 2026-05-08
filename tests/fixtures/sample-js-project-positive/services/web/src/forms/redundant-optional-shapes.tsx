/**
 * redundant-optional shape that should NOT fire:
 *
 * Discriminated-union variants use `field?: undefined` to encode
 * "this variant does not carry the field". Dropping the
 * `| undefined` would compile but loses the exclusivity-pattern
 * convention — readers expect to see `?: undefined` on the
 * negative arm to make the variants visually parallel.
 */

export type DownloadOption =
  | { downloadable: true; signature: string }
  | { downloadable: false; signature?: undefined };

export function getLabel(opt: DownloadOption): string {
  return opt.downloadable ? `Signed: ${opt.signature}` : "Not downloadable";
}
