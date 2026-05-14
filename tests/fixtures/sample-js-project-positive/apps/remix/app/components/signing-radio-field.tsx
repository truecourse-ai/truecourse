
// --- react-useless-set-state FP: setSelectedOption called with handler param, not current state ---
declare function useState<T>(init: T): [T, (v: T) => void];

function SigningRadioField({ options }: { options: string[] }) {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);

  const handleSelectItem = (selectedOption: string) => {
    setSelectedOption(selectedOption);
  };

  return (
    <div>
      {options.map((opt) => (
        <button key={opt} onClick={() => handleSelectItem(opt)}>{opt}</button>
      ))}
      <p>Selected: {selectedOption}</p>
    </div>
  );
}
