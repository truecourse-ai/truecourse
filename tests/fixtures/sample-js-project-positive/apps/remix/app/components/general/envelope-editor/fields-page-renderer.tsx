
// FP shape: component body with multiple hook destructurings
declare function useLingui(): { _: (d: unknown) => string; i18n: unknown };
declare function useCurrentEnvelopeEditor(): { envelope: unknown; editorFields: unknown[]; getRecipientColorKey: (id: string) => string };
declare function useCurrentEnvelopeRender(): { currentEnvelopeItem: unknown; setRenderError: (e: Error) => void };

export const FieldsPageRenderer = ({ pageIndex }: { pageIndex: number }) => {
  const { _, i18n } = useLingui();
  const { envelope, editorFields, getRecipientColorKey } = useCurrentEnvelopeEditor();
  const { currentEnvelopeItem, setRenderError } = useCurrentEnvelopeRender();

  return null;
};

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;
