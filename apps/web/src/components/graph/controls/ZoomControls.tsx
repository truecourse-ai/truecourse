'use client';

import { useReactFlow } from '@xyflow/react';
import { ZoomIn, ZoomOut, Maximize2, LayoutGrid, Hand, Move } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

type ZoomControlsProps = {
  onAutoLayout?: () => void;
  panMode?: boolean;
  onTogglePanMode?: () => void;
};

export function ZoomControls({ onAutoLayout, panMode, onTogglePanMode }: ZoomControlsProps) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  return (
    <div className="absolute bottom-4 left-4 z-10 flex flex-col gap-1 rounded-lg border border-border bg-card p-1 shadow-md">
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => zoomIn()}
        aria-label="Zoom in"
      >
        <ZoomIn className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => zoomOut()}
        aria-label="Zoom out"
      >
        <ZoomOut className="h-4 w-4" />
      </Button>
      <Separator />
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => fitView({ padding: 0.3, duration: 300 })}
        aria-label="Fit view"
      >
        <Maximize2 className="h-4 w-4" />
      </Button>
      {onAutoLayout && (
        <>
          <Separator />
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => {
              onAutoLayout();
              setTimeout(() => fitView({ padding: 0.3, duration: 300 }), 50);
            }}
            aria-label="Auto layout"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </>
      )}
      {onTogglePanMode && (
        <>
          <Separator />
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onTogglePanMode}
            aria-label={panMode ? 'Switch to select mode' : 'Switch to move mode'}
            title={panMode ? 'Switch to select mode' : 'Switch to move mode'}
          >
            {panMode ? <Move className="h-4 w-4" /> : <Hand className="h-4 w-4" />}
          </Button>
        </>
      )}
    </div>
  );
}
