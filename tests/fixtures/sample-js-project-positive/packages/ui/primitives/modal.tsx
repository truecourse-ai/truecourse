// Single component uses position = 'start' as a prop default — one usage
interface ModalProps {
  title: string;
  position?: 'start' | 'center' | 'end';
  children: unknown;
}

function Modal({ title, position = 'start', children }: ModalProps) {
  return { title, position, children };
}
