
// FP shape: component with destructured props and standard hook calls
declare function useNavigate(): (path: string) => void;
declare function useParams(): { folderId?: string };
declare const DEFAULT_TIMEZONE: string;

type DocumentUploadButtonProps = {
  className?: string;
  type: string;
};

export const DocumentUploadButton = ({ className, type }: DocumentUploadButtonProps) => {
  const { _ } = useLingui();
  const { toast } = useToast();
  const { user } = useSession();
  const { folderId } = useParams();
  const navigate = useNavigate();

  return null;
};
