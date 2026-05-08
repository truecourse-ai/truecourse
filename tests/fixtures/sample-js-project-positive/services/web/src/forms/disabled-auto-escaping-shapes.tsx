/**
 * disabled-auto-escaping shape that should NOT fire:
 *
 * - `dangerouslySetInnerHTML` whose source is a known SVG/QR
 *   generator (`mermaid.render`, `renderSVG`, `qrcode.toString`,
 *   `qrcode.toSVG`). The output is library-controlled markup,
 *   not user input.
 * - SSR public-env script injection: `__html: \`window.env =
 *   ${JSON.stringify(env)}\``. JSON.stringify is the safety
 *   boundary; the pattern is the canonical SSR public-env
 *   handoff.
 */

declare const mermaid: { render(id: string, src: string): { svg: string } };
declare const renderSVG: (data: string) => string;

interface Props {
  readonly source: string;
  readonly qrData: string;
}

export function DiagramAndQr({ source, qrData }: Props): JSX.Element {
  const diagramSvg = mermaid.render("d", source).svg;
  const qrSvg = renderSVG(qrData);
  const publicEnv = { API_URL: "/api" };
  return (
    <div>
      <div dangerouslySetInnerHTML={{ __html: diagramSvg }} />
      <div dangerouslySetInnerHTML={{ __html: qrSvg }} />
      <script
        dangerouslySetInnerHTML={{
          __html: `window.__ENV__ = ${JSON.stringify(publicEnv)};`,
        }}
      />
    </div>
  );
}
