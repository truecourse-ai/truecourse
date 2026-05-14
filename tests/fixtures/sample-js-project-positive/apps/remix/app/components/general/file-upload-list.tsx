
// FP: React component with drag-and-drop JSX — standard React framework structure inflates line count
declare const Droppable: React.FC<{ droppableId: string; children: (provided: { droppableProps: Record<string, unknown>; innerRef: React.Ref<HTMLDivElement> }) => React.ReactNode }>;
declare const Draggable: React.FC<{ key: string; draggableId: string; isDragDisabled?: boolean; children: (provided: { draggableProps: Record<string, unknown>; dragHandleProps: Record<string, unknown>; innerRef: React.Ref<HTMLDivElement> }) => React.ReactNode }>;
declare const GripVerticalIcon: React.FC<{ className?: string }>;
declare const TrashIcon: React.FC<{ className?: string }>;
declare const Spinner: React.FC<{ className?: string }>;
declare function cn(...classes: (string | undefined | false)[]): string;

type UploadedFile = {
  id: string;
  title: string;
  isUploading: boolean;
  isReplacing: boolean;
  isError: boolean;
  canDelete?: boolean;
};

type FileUploadListProps = {
  files: UploadedFile[];
  isDragDisabled?: boolean;
  onDelete: (id: string) => void;
  onReplace?: (id: string) => void;
};

export const FileUploadList = ({ files, isDragDisabled, onDelete, onReplace }: FileUploadListProps) => {
  return (
    <Droppable droppableId="files">
      {(provided) => (
        <div
          data-testid="file-upload-list"
          {...provided.droppableProps}
          ref={provided.innerRef}
          className="space-y-2"
        >
          {files.map((file, index) => (
            <Draggable
              key={file.id}
              isDragDisabled={
                isDragDisabled ||
                file.isReplacing ||
                file.isUploading
              }
              draggableId={file.id}
            >
              {(drag) => (
                <div
                  {...drag.draggableProps}
                  ref={drag.innerRef}
                  className={cn(
                    'flex items-center gap-2 rounded-md border bg-background p-3',
                    file.isError && 'border-destructive',
                  )}
                >
                  <span
                    {...drag.dragHandleProps}
                    className={cn(
                      'cursor-grab text-muted-foreground',
                      isDragDisabled && 'cursor-default opacity-30',
                    )}
                  >
                    <GripVerticalIcon className="h-4 w-4" />
                  </span>

                  <span className="flex-1 truncate text-sm">{file.title}</span>

                  {(file.isUploading || file.isReplacing) && (
                    <Spinner className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}

                  {file.canDelete && !file.isUploading && !file.isReplacing && (
                    <button
                      type="button"
                      onClick={() => onDelete(file.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}
            </Draggable>
          ))}
        </div>
      )}
    </Droppable>
  );
};
