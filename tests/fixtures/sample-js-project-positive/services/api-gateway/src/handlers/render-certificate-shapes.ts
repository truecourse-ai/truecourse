/**
 * sync-fs-in-request-handler shape that should NOT fire:
 *
 * PDF / image / certificate renderers read static brand assets
 * (`logo.png`, `cert-template.pdf`, `font.ttf`) once per render
 * pass. The render functions are async (so they trip the
 * "inside async function" check), but the sync read is for a
 * fixed asset path; replacing it with `fs.promises.readFile`
 * adds no concurrency benefit and changes the call shape.
 */

import { readFileSync } from "fs";
import { join } from "path";

const ASSETS_DIR = "/etc/app/assets";

export async function renderCertificate(name: string): Promise<Buffer> {
  const logoPath = join(ASSETS_DIR, "logo.png");
  const logoBytes = readFileSync(logoPath);
  return Buffer.concat([logoBytes, Buffer.from(name)]);
}
