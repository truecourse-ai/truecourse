
// --- react-readonly-props FP: string literal union prop ---
interface DocumentViewProps {
  type?: 'document' | 'template';
  title: string;
  onClose?: () => void;
}

function DocumentView({ type = 'document', title, onClose }: DocumentViewProps) {
  return <div className={`view-${type}`}><h2>{title}</h2></div>;
}
