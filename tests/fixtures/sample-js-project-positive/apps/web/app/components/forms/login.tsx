
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useNavigate(): (path: string) => void;

function LoginForm({ returnTo }: { returnTo?: string }) {
  const navigate = useNavigate();
  const [is2FAOpen, setIs2FAOpen] = useState(false);
  const [authMethod, setAuthMethod] = useState<'totp' | 'backup'>('totp');

  const onToggleAuthMethod = () => {
    const next = authMethod === 'totp' ? 'backup' : 'totp';
    setAuthMethod(next);
  };

  return null;
}
