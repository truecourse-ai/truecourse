declare const field: { onChange: (v: number) => void };

const TeamCountInput = () => {
  return (
    <input
      type="number"
      min={0}
      onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 0)}
    />
  );
};

const MemberCountInput = () => {
  const memberField = field;
  return (
    <input
      type="number"
      min={0}
      onChange={(e) => memberField.onChange(parseInt(e.target.value, 10) || 0)}
    />
  );
};
