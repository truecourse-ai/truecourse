
// FF44 — Array.find with null fallback via || null; standard pattern, no type mismatch
type Participant = { id: number; name: string; role: string };
declare const session: { participants: Participant[] };
declare const selectedAssistantId: number | null;

const activeParticipant: Participant | null =
  session.participants.find((p) => p.id === selectedAssistantId) || null;



// --- argument-type-mismatch FP: flatMap+filter chain with enum comparison ---
enum InputType {
  TEXT = 'TEXT',
  CHECKBOX = 'CHECKBOX',
  SIGNATURE = 'SIGNATURE',
  DATE = 'DATE',
}

enum CompletionStatus {
  COMPLETED = 'COMPLETED',
  PENDING = 'PENDING',
}

interface FormInput {
  id: string;
  type: InputType;
  value?: string;
}

interface FormSection {
  id: string;
  completionStatus: CompletionStatus;
  inputs: FormInput[];
}

declare const formSections: FormSection[];

const editableInputs = formSections
  .filter((s) => s.completionStatus !== CompletionStatus.COMPLETED)
  .flatMap((s) => s.inputs.filter((input) => input.type !== InputType.SIGNATURE));
