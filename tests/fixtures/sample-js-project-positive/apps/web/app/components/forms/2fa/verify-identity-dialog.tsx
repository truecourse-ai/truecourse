
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useForm<T>(opts: any): any;
declare const zodResolver: (schema: any) => any;
declare const z: any;

const ZVerifyIdentityForm = z.object({
  totpCode: z.string().trim().optional(),
  backupCode: z.string().trim().optional(),
});

type TVerifyIdentityForm = { totpCode?: string; backupCode?: string };

export function VerifyIdentityDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [verificationMethod, setVerificationMethod] = useState<'totp' | 'backup'>('totp');

  const verifyForm = useForm<TVerifyIdentityForm>({
    defaultValues: { totpCode: '', backupCode: '' },
    resolver: zodResolver(ZVerifyIdentityForm),
  });

  const onToggleMethod = () => {
    const method = verificationMethod === 'totp' ? 'backup' : 'totp';
    if (method === 'totp') {
      verifyForm.setValue('backupCode', '');
    } else {
      verifyForm.setValue('totpCode', '');
    }
    setVerificationMethod(method);
  };

  return null;
}
