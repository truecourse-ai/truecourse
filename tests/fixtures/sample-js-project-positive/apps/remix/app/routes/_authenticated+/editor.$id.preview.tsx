// ContractEditorPreviewPage — react-tsx FP shape with multiple hooks, useEffect for lazy import
declare const useCurrentContractEditor_preview: () => {
  contract: { id: number; title: string };
  editorConfig: { allowPreview: boolean };
  navigateToStep: (step: string) => void;
};
declare const useCurrentContractRender_preview: () => {
  renderMode: string;
  setRenderMode: (m: string) => void;
};
declare const useRef_preview: <T>(v: T | null) => { current: T | null };
declare const useState_preview: <T>(v: T) => [T, (v: T) => void];
declare const useEffect_preview: (fn: () => void | (() => void), deps: unknown[]) => void;
declare const useMemo_preview: <T>(fn: () => T, deps: unknown[]) => T;

type PreviewMode = 'desktop' | 'mobile' | 'print';

export const ContractEditorPreviewPage = () => {
  const {
    contract,
    editorConfig,
    navigateToStep,
  } = useCurrentContractEditor_preview();

  const { renderMode, setRenderMode } = useCurrentContractRender_preview();

  const previewRef = useRef_preview<HTMLDivElement>(null);

  const [selectedPreviewMode, setSelectedPreviewMode] = useState_preview<PreviewMode>('desktop');
  const [fakerInstance, setFakerInstance] = useState_preview<unknown>(null);

  useEffect_preview(() => {
    let cancelled = false;
    void import('@faker-js/faker').then(({ faker }) => {
      if (!cancelled) setFakerInstance(faker);
    });
    return () => { cancelled = true; };
  }, []);

  const previewData = useMemo_preview(() => {
    if (!fakerInstance) return null;
    const faker = fakerInstance as { person: { fullName: () => string }; internet: { email: () => string } };
    return {
      recipientName: faker.person.fullName(),
      recipientEmail: faker.internet.email(),
    };
  }, [fakerInstance]);

  const previewModes: Array<{ label: string; value: PreviewMode }> = [
    { label: 'Desktop', value: 'desktop' },
    { label: 'Mobile', value: 'mobile' },
    { label: 'Print', value: 'print' },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigateToStep('fields')}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to Fields
          </button>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-medium">Preview</span>
        </div>

        <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
          {previewModes.map((mode) => (
            <button
              key={mode.value}
              onClick={() => setSelectedPreviewMode(mode.value)}
              className={`rounded px-3 py-1 text-xs font-medium ${
                selectedPreviewMode === mode.value
                  ? 'bg-primary text-white'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => navigateToStep('send')}
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-white"
        >
          Continue to Send
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div
          ref={previewRef}
          className={`flex-1 overflow-y-auto bg-gray-100 p-4 ${
            selectedPreviewMode === 'mobile' ? 'flex items-start justify-center' : ''
          }`}
        >
          <div
            className={`relative bg-white shadow-lg ${
              selectedPreviewMode === 'mobile' ? 'w-96' : 'w-full'
            }`}
          >
            {previewData ? (
              <div className="p-6">
                <p className="text-sm text-muted-foreground">
                  Preview as: {previewData.recipientName} ({previewData.recipientEmail})
                </p>
              </div>
            ) : (
              <div className="flex h-64 items-center justify-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
