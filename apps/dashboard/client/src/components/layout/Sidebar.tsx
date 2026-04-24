
import { useCallback, useRef, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';

type SidebarProps = {
  children: React.ReactNode;
  isOpen: boolean;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
};

export function Sidebar({
  children,
  isOpen,
  defaultWidth = 387,
  minWidth = 260,
  maxWidth = 780,
}: SidebarProps) {
  const [width, setWidth] = useState(defaultWidth);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      const startX = e.clientX;
      const startWidth = width;

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!isDragging.current) return;
        const delta = startX - moveEvent.clientX;
        const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + delta));
        setWidth(newWidth);
      };

      const onMouseUp = () => {
        isDragging.current = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [width, minWidth, maxWidth],
  );

  if (!isOpen) return null;

  return (
    <aside
      className="relative flex-shrink-0 border-l border-border bg-card"
      style={{ width }}
    >
      {/* Resize handle */}
      <div
        className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50"
        onMouseDown={handleMouseDown}
      />
      <ScrollArea className="h-full">{children}</ScrollArea>
    </aside>
  );
}
