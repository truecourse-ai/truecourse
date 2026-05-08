/**
 * unnecessary-condition shape that should NOT fire:
 *
 * Closure-mutated cancel flag in async loaders. `isCancelled` is
 * declared `let isCancelled = false` and flipped to `true` in
 * the effect's cleanup callback. After every `await` the
 * coroutine resumes and must check whether the effect has been
 * torn down — flagging this as "always falsy" because the type
 * query reports the initial `false` literal type is wrong.
 */

import { useEffect, useState } from "react";

declare const fetchPdf: (url: string) => Promise<ArrayBuffer>;

interface Props {
  readonly url: string;
}

export function PdfViewer({ url }: Props): JSX.Element {
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);

  useEffect(() => {
    let isCancelled = false;
    void (async () => {
      const data = await fetchPdf(url);
      if (isCancelled) return;
      const second = await fetchPdf(`${url}?retry=1`);
      if (isCancelled) return;
      setBytes(data ?? second);
    })();
    return () => {
      isCancelled = true;
    };
  }, [url]);

  return <div data-bytes={bytes?.byteLength ?? 0} />;
}
