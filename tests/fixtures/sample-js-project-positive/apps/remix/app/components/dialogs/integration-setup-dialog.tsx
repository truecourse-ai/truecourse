// Single dialog file with distinct step names in useState — not duplicates of each other
declare function useState<T>(initial: T): [T, (v: T) => void];

type SetupStep = 'CONNECT' | 'CONFIGURE' | 'REVIEW' | 'DONE';

function IntegrationSetupDialog() {
  const [currentStep, setStep] = useState<SetupStep>('CONNECT');

  const stepLabels: Record<SetupStep, string> = {
    CONNECT: 'Connect',
    CONFIGURE: 'Configure',
    REVIEW: 'Review',
    DONE: 'Done',
  };

  return { currentStep, setStep, stepLabels };
}
