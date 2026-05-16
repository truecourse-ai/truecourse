// Two independent dialogs each initialize their own step state — parallel standalone usage
declare function useState<T>(initial: T): [T, (v: T) => void];

type PromptStep = 'PROMPT' | 'CONFIRM' | 'DONE';

function AiFieldDetectionDialog() {
  const [step, setStep] = useState<PromptStep>('PROMPT');
  return { step, setStep };
}

function AiTemplateGenerationDialog() {
  const [step, setStep] = useState<PromptStep>('PROMPT');
  return { step, setStep };
}



// [unknown-catch-variable] catch(err) — instanceof AiApiError + instanceof Error guards before access
declare class AiApiError extends Error { code: string; retryable: boolean }
declare function runFieldDetection(documentId: string, hints: string[]): Promise<Array<{ name: string; type: string }>>;
declare const detectionToast: (opts: { title: string; description: string; variant?: string }) => void;

async function attemptAiFieldDetection(documentId: string, hints: string[]): Promise<Array<{ name: string; type: string }>> {
  try {
    return await runFieldDetection(documentId, hints);
  } catch (err) {
    if (err instanceof AiApiError) {
      const description = err.retryable ? 'The AI service is busy. Please try again.' : `AI detection failed: ${err.code}`;
      detectionToast({ title: 'Detection failed', description, variant: 'destructive' });
    } else if (err instanceof Error) {
      detectionToast({ title: 'Detection failed', description: err.message, variant: 'destructive' });
    } else {
      detectionToast({ title: 'Detection failed', description: 'An unknown error occurred.', variant: 'destructive' });
    }
    return [];
  }
}
