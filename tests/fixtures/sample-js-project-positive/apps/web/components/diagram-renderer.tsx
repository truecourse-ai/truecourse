// dangerouslySetInnerHTML with SVG from diagram renderer library — library output, not user-controlled HTML
declare const diagramRenderer: { render: (id: string, definition: string) => Promise<{ svg: string; bindFunctions?: (el: HTMLElement) => void }> };

function DiagramBlock({ definition, id }: { definition: string; id: string }) {
  const [svg, setSvg] = React.useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { svg: rendered, bindFunctions } = await diagramRenderer.render(id, definition);
      if (!cancelled) {
        setSvg(rendered);
        if (containerRef.current) bindFunctions?.(containerRef.current);
      }
    })();
    return () => { cancelled = true; };
  }, [definition, id]);

  if (!svg) return null;

  return <div ref={containerRef} dangerouslySetInnerHTML={{ __html: svg }} />;
}
