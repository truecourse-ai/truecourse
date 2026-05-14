// Single file defines editor steps with unique ids — each is a distinct step, not a duplicate
interface EditorStep {
  id: string;
  label: string;
  completed: boolean;
}

const editorSteps: EditorStep[] = [
  { id: 'upload', label: 'Upload document', completed: false },
  { id: 'recipients', label: 'Add recipients', completed: false },
  { id: 'fields', label: 'Place fields', completed: false },
  { id: 'review', label: 'Review & send', completed: false },
];
