interface ClickEvent {
  readonly preventDefault: () => void;
}

interface MenuItemProps {
  readonly label: string;
  readonly onClick: (e: ClickEvent) => void;
}

function MenuItem({ label, onClick }: MenuItemProps): JSX.Element {
  return <li><button type="button" onClick={onClick}>{label}</button></li>;
}

interface PanelProps {
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

export function Panel({ onClose, onConfirm }: PanelProps): JSX.Element {
  const preventA = (e: ClickEvent): void => e.preventDefault();
  const preventB = (e: ClickEvent): void => e.preventDefault();
  const closeA = (): void => onClose();
  const closeB = (): void => onClose();
  const confirmA = (): void => onConfirm();
  const confirmB = (): void => onConfirm();
  return (
    <ul>
      <MenuItem label="Cancel" onClick={preventA} />
      <MenuItem label="Confirm" onClick={preventB} />
      <MenuItem label="Close" onClick={closeA} />
      <MenuItem label="Back" onClick={closeB} />
      <MenuItem label="OK" onClick={confirmA} />
      <MenuItem label="Yes" onClick={confirmB} />
    </ul>
  );
}
