declare const Badge: (props: { children: React.ReactNode; variant?: string }) => JSX.Element;
declare const Button: (props: { children: React.ReactNode; onClick?: () => void; variant?: string; size?: string; className?: string }) => JSX.Element;
declare const ScrollArea: (props: { children: React.ReactNode; className?: string }) => JSX.Element;
declare const FileText: (props: { className?: string }) => JSX.Element;
declare const formatDate: (d: Date) => string;

type MultiSignDoc = {
  id: string;
  title: string;
  senderName: string;
  status: 'pending' | 'completed' | 'expired';
  dueAt?: Date;
  fieldCount: number;
};

type MultiSignDocumentListProps = {
  documents: MultiSignDoc[];
  onSelect: (docId: string) => void;
  selectedDocId?: string;
  isLoading?: boolean;
};

export function MultiSignDocumentList({
  documents,
  onSelect,
  selectedDocId,
  isLoading = false,
}: MultiSignDocumentListProps) {
  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <span className="text-sm text-muted-foreground">Loading documents...</span>
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">No documents pending signature.</p>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col gap-2 p-4">
        {documents.map((doc) => (
          <button
            key={doc.id}
            onClick={() => onSelect(doc.id)}
            className={`w-full rounded-lg border p-4 text-left transition-colors hover:bg-muted/50 ${
              selectedDocId === doc.id ? 'border-primary bg-muted/30' : ''
            }`}
          >
            <div className="flex items-start gap-3">
              <FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="flex-1 overflow-hidden">
                <p className="truncate font-medium">{doc.title}</p>
                <p className="text-xs text-muted-foreground">From {doc.senderName}</p>
                {doc.dueAt && (
                  <p className="text-xs text-muted-foreground">Due {formatDate(doc.dueAt)}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge variant={doc.status === 'completed' ? 'default' : doc.status === 'expired' ? 'destructive' : 'secondary'}>
                  {doc.status}
                </Badge>
                <span className="text-xs text-muted-foreground">{doc.fieldCount} fields</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}
