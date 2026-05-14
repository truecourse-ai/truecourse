declare function onOpenChange(v: boolean): void;

const TwoFactorAuthDialog = () => {
  return (
    <div>
      <button type="button" onClick={() => onOpenChange(false)}>
        Close
      </button>
    </div>
  );
};
