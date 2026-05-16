
// FP shape fc60616b3a1c: renderCheckboxGroup generic function with Dispatch<SetStateAction<T>> — no type mismatch
declare function useState<T>(init: T): [T, React.Dispatch<React.SetStateAction<T>>];

const renderCheckboxGroup = <T extends Record<string, boolean>>(
  label: string,
  state: T,
  setState: React.Dispatch<React.SetStateAction<T>>,
) => (
  <fieldset style={{ border: '1px solid #ccc', padding: '8px', marginBottom: '8px', borderRadius: '4px' }}>
    <legend style={{ fontWeight: 'bold', fontSize: '13px' }}>{label}</legend>
    {Object.entries(state).map(([key, value]) => (
      <label key={key} style={{ display: 'block', fontSize: '12px', marginBottom: '2px' }}>
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => setState((prev) => ({ ...prev, [key]: e.target.checked }))}
          style={{ marginRight: '4px' }}
        />
        {key}
      </label>
    ))}
  </fieldset>
);
