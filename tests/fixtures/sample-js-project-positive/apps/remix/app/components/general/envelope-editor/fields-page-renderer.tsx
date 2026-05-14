
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
