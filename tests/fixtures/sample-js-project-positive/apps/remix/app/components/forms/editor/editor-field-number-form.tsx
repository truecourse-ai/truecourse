declare const minField: { onChange: (v: string | null) => void; value: string | null };
declare const maxField: { onChange: (v: string | null) => void; value: string | null };

const NumberFieldValidation = () => {
  return (
    <div className="flex flex-row gap-x-4">
      <input
        placeholder="E.g. 0"
        value={minField.value ?? ''}
        onChange={(e) => minField.onChange(e.target.value === '' ? null : e.target.value)}
      />
      <input
        placeholder="E.g. 100"
        value={maxField.value ?? ''}
        onChange={(e) => maxField.onChange(e.target.value === '' ? null : e.target.value)}
      />
    </div>
  );
};
