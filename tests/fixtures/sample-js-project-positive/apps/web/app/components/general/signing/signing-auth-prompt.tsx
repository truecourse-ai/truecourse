
declare function useState<T>(init: T): [T, (v: T) => void];

export type SigningAuthPromptProps = {
  actionTarget?: 'FIELD' | 'DOCUMENT';
  onClose: (value: boolean) => void;
};

export function SigningAuthPrompt({
  actionTarget = 'FIELD',
  onClose,
}: SigningAuthPromptProps) {
  const [isBusy, setIsBusy] = useState(false);

  const handleSwitch = async (email: string) => {
    try {
      setIsBusy(true);
      const returnPath = window.location.pathname + window.location.search;
      await fetch(`/api/auth/signout?returnTo=${encodeURIComponent(returnPath)}`);
    } catch {
      setIsBusy(false);
    }
  };

  return null;
}
