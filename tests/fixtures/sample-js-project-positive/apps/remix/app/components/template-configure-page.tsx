
// --- react-useless-set-state FP: setEmail(email) uses handler parameter not current state ---
declare function useState<T>(init: T): [T, (v: T) => void];

interface ConfigureFormSchema { email: string }
interface RecipientState { email: string; name: string }

function TemplatePage({ initialRecipient }: { initialRecipient: RecipientState }) {
  const [email, setEmail] = useState('');
  const [recipient, setRecipient] = useState<RecipientState>(initialRecipient);

  const onConfigureSubmit = ({ email }: ConfigureFormSchema) => {
    setEmail(email);
    setRecipient({ ...recipient, email });
  };

  return <div><p>{email}</p><p>{recipient.name}</p></div>;
}
