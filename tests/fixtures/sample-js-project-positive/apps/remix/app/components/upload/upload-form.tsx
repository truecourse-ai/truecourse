
// FP shape f81e12025a6f: useState initialized via array .map() with object literal shape — no type mismatch
declare const workspaceData: { attachments: Array<{ id: string; title: string; order: number }> };
declare function useState<T>(init: T): [T, (v: T | ((prev: T) => T)) => void];

type LocalAttachment = {
  id: string;
  title: string;
  attachmentId: string;
  isUploading: boolean;
  isReplacing: boolean;
  isError: boolean;
};

function useAttachmentState() {
  const [localAttachments, setLocalAttachments] = useState<LocalAttachment[]>(
    workspaceData.attachments
      .sort((a, b) => a.order - b.order)
      .map((item) => ({
        id: item.id,
        title: item.title,
        attachmentId: item.id,
        isUploading: false,
        isReplacing: false,
        isError: false,
      })),
  );
  return { localAttachments, setLocalAttachments };
}



// FP shape f85bcb177ac8: setLocalFiles updater with filter+concat and map producing typed objects — no type mismatch
declare function useState<T>(init: T): [T, (updater: (prev: T) => T) => void];

type UploadedFile = { id: string; attachmentId: string; title: string; isUploading: boolean; isError: boolean };
type UploadResult = { id: string; title: string };

function useFileUploadState(initial: UploadedFile[]) {
  const [localFiles, setLocalFiles] = useState<UploadedFile[]>(initial);

  function onUploadSuccess(newFiles: UploadedFile[], data: UploadResult[]) {
    setLocalFiles((prev) => {
      const filteredFiles = prev.filter(
        (f) => f.id !== newFiles.find((nf) => nf.id === f.id)?.id,
      );

      return filteredFiles.concat(
        data.map((item) => ({
          id: item.id,
          attachmentId: item.id,
          title: item.title,
          isUploading: false,
          isError: false,
        })),
      );
    });
  }

  return { localFiles, onUploadSuccess };
}



declare const useLingui4: () => { _: (msg: unknown) => string };
declare const useToast4: () => { toast: (opts: { title: string; description?: string; variant?: string; duration?: number }) => void };
declare const useSession4: () => { user: { id: string; emailVerified: boolean } };
declare const useParams4: () => { folderId?: string };
declare const useCurrentTeam4: () => { id: number; url: string };
declare const useNavigate4: () => (path: string) => void;
declare const useCurrentOrg4: () => { id: string; name: string };
declare const useLimits4: () => { quota: { documents: number }; remaining: { documents: number }; refreshLimits: () => void };
declare const useState4: <T>(init: T) => [T, (v: T) => void];
declare const useMemo4: <T>(fn: () => T, deps: unknown[]) => T;
declare const msg4: (strings: TemplateStringsArray, ...vals: unknown[]) => unknown;
declare const trpc4: { template: { createFromFile: { useMutation: () => { mutateAsync: (data: unknown) => Promise<{ id: string }> } } }; document: { createFromFile: { useMutation: () => { mutateAsync: (data: unknown) => Promise<{ id: string }> } } } };
declare const TemplateUploadButton4: React.ComponentType<{ className?: string; onDrop: (files: File[], rejected: unknown[]) => void; disabled?: boolean }>;
declare const Tooltip4: React.ComponentType<{ children: React.ReactNode }>;
declare const TooltipTrigger4: React.ComponentType<{ asChild?: boolean; children: React.ReactNode }>;
declare const TooltipContent4: React.ComponentType<{ children: React.ReactNode }>;
declare const TooltipProvider4: React.ComponentType<{ children: React.ReactNode }>;
declare const buildRejectionDesc4: (rejected: unknown[]) => string;
declare const cn4: (...classes: unknown[]) => string;
declare const match4: <T>(val: T) => { with: (...args: unknown[]) => { otherwise: (fn: () => unknown) => unknown } };

type TemplateUploadButtonLegacyProps = {
  className?: string;
  type: 'TEMPLATE' | 'DOCUMENT';
};

export const TemplateUploadButtonLegacy = ({ className, type }: TemplateUploadButtonLegacyProps) => {
  const { _ } = useLingui4();
  const { toast } = useToast4();
  const { user } = useSession4();
  const { folderId } = useParams4();

  const team = useCurrentTeam4();
  const navigate = useNavigate4();
  const org = useCurrentOrg4();

  const { quota, remaining, refreshLimits } = useLimits4();

  const [isLoading, setIsLoading] = useState4(false);

  const { mutateAsync: createTemplate } = trpc4.template.createFromFile.useMutation();
  const { mutateAsync: createDocument } = trpc4.document.createFromFile.useMutation();

  const disabledMessage = useMemo4(() => {
    if (!user.emailVerified) {
      return msg4`Verify your email to upload files.`;
    }

    if (type === 'DOCUMENT' && remaining.documents <= 0) {
      return msg4`You have reached your document upload limit.`;
    }

    return null;
  }, [user.emailVerified, type, remaining.documents]);

  const handleDrop = async (acceptedFiles: File[], rejectedFiles: unknown[]) => {
    if (rejectedFiles && (rejectedFiles as unknown[]).length > 0) {
      toast({
        title: _(msg4`Upload failed`),
        description: buildRejectionDesc4(rejectedFiles),
        variant: 'destructive',
        duration: 7500,
      });
      return;
    }

    if (acceptedFiles.length === 0) return;

    try {
      setIsLoading(true);

      const file = acceptedFiles[0];

      if (type === 'TEMPLATE') {
        const result = await createTemplate({ file });
        navigate(`/${team.url}/templates/${result.id}/edit`);
      } else {
        const result = await createDocument({ file, folderId });
        navigate(`/${team.url}/documents/${result.id}`);
      }

      refreshLimits();
    } catch {
      toast({
        title: _(msg4`Upload error`),
        description: _(msg4`We could not process your file. Please try a different file.`),
        variant: 'destructive',
        duration: 7500,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <TooltipProvider4>
      <Tooltip4>
        <TooltipTrigger4 asChild>
          <TemplateUploadButton4
            className={cn4('w-full', className)}
            onDrop={handleDrop}
            disabled={!!disabledMessage || isLoading}
          />
        </TooltipTrigger4>

        {disabledMessage && (
          <TooltipContent4>
            <p>{_(disabledMessage)}</p>
          </TooltipContent4>
        )}
      </Tooltip4>
    </TooltipProvider4>
  );
};
