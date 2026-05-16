declare function syncDocument(): Promise<void>;
declare function DirectLinkDialog(props: any): any;

const EditorSidebar = () => {
  return (
    <DirectLinkDialog
      onCreateSuccess={async () => await syncDocument()}
      onDeleteSuccess={async () => await syncDocument()}
      trigger={<button type="button">Direct Link</button>}
    />
  );
};



declare const useNavigate2: () => (path: string) => void;
declare const useSearchParams3: () => [URLSearchParams, (params: URLSearchParams) => void];
declare const useCurrentEnvelopeEditor2: () => { envelope: unknown; isDocument: boolean; isTemplate: boolean; navigateToStep: (step: string) => void; syncEnvelope: () => Promise<void>; flushAutosave: () => Promise<void> };
declare const match3: <T>(v: T) => { with: (cases: Partial<Record<string, () => React.ReactNode>>) => { otherwise: (fn: () => React.ReactNode) => React.ReactNode } };
declare const UploadStepForm: React.FC<{ envelope: unknown; onNext: () => void }>;
declare const RecipientsStepForm: React.FC<{ envelope: unknown; onNext: () => void; onBack: () => void }>;
declare const FieldsStepForm: React.FC<{ envelope: unknown; onNext: () => void; onBack: () => void }>;
declare const PreviewStepForm: React.FC<{ envelope: unknown; onBack: () => void; onSend: () => Promise<void> }>;
declare const StepIndicator: React.FC<{ steps: string[]; current: string }>;
declare const React: { FC: unknown; ReactNode: unknown };

export function DocumentFlowEditor() {
  const navigate = useNavigate2();
  const { envelope, isDocument, navigateToStep, syncEnvelope, flushAutosave } = useCurrentEnvelopeEditor2();
  const [searchParams, setSearchParams] = useSearchParams3();

  const currentStep = searchParams.get('step') ?? 'upload';

  const steps = isDocument
    ? ['upload', 'recipients', 'fields', 'preview']
    : ['upload', 'recipients', 'fields'];

  const handleNext = () => {
    const idx = steps.indexOf(currentStep);
    if (idx < steps.length - 1) {
      const next = steps[idx + 1];
      const params = new URLSearchParams(searchParams);
      params.set('step', next);
      setSearchParams(params);
    }
  };

  const handleBack = () => {
    const idx = steps.indexOf(currentStep);
    if (idx > 0) {
      const prev = steps[idx - 1];
      const params = new URLSearchParams(searchParams);
      params.set('step', prev);
      setSearchParams(params);
    }
  };

  const handleSend = async () => {
    await flushAutosave();
    await syncEnvelope();
    navigate('/documents');
  };

  return (
    <div className="flex h-full flex-col">
      <StepIndicator steps={steps} current={currentStep} />

      <div className="flex-1 overflow-y-auto">
        {currentStep === 'upload' && (
          <UploadStepForm envelope={envelope} onNext={handleNext} />
        )}
        {currentStep === 'recipients' && (
          <RecipientsStepForm envelope={envelope} onNext={handleNext} onBack={handleBack} />
        )}
        {currentStep === 'fields' && (
          <FieldsStepForm envelope={envelope} onNext={handleNext} onBack={handleBack} />
        )}
        {currentStep === 'preview' && isDocument && (
          <PreviewStepForm envelope={envelope} onBack={handleBack} onSend={handleSend} />
        )}
      </div>
    </div>
  );
}
