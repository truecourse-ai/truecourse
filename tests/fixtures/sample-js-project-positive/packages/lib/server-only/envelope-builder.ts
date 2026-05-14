
// FP shape: function with a single typed parameter (not destructured, not complex)
type UpdateEnvelopeInput = {
  title: string;
  type: string;
  recipients: Array<{ email: string; name: string; role: string }>;
  meta: { timezone?: string; language?: string };
};

type UpdateEnvelopePayload = {
  payload: UpdateEnvelopeInput;
  files: File[];
};

const buildUpdateEnvelopeRequest = (envelope: UpdateEnvelopeInput): UpdateEnvelopePayload => {
  const files: File[] = [];
  return {
    payload: envelope,
    files,
  };
};
