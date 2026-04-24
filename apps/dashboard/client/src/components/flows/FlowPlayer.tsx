import { useState, useEffect, useCallback, useRef } from 'react';
import { Play, Pause, SkipBack, SkipForward, ChevronFirst, ChevronLast, RotateCcw } from 'lucide-react';

type FlowPlayerProps = {
  totalSteps: number;
  currentStep: number;
  onStepChange: (step: number) => void;
  isPlaying: boolean;
  onPlayPause: () => void;
};

const SPEEDS = [0.5, 1, 2] as const;

export function FlowPlayer({ totalSteps, currentStep, onStepChange, isPlaying, onPlayPause }: FlowPlayerProps) {
  const [speed, setSpeed] = useState<number>(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isAtEnd = currentStep >= totalSteps;

  // Auto-advance during playback
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (isPlaying && currentStep < totalSteps) {
      intervalRef.current = setInterval(() => {
        onStepChange(currentStep + 1);
      }, 1000 / speed);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, currentStep, totalSteps, speed, onStepChange]);

  // Pause when reaching the end — delay so last step animates
  useEffect(() => {
    if (isPlaying && currentStep >= totalSteps) {
      const timeout = setTimeout(() => {
        onPlayPause();
      }, 1000 / speed);
      return () => clearTimeout(timeout);
    }
  }, [currentStep, totalSteps, isPlaying, onPlayPause, speed]);

  const cycleSpeed = useCallback(() => {
    setSpeed((prev) => {
      const idx = SPEEDS.indexOf(prev as typeof SPEEDS[number]);
      return SPEEDS[(idx + 1) % SPEEDS.length];
    });
  }, []);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 shadow-sm">
      {/* Jump to start */}
      <button
        onClick={() => onStepChange(0)}
        disabled={currentStep === 0}
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 transition-colors"
        title="Jump to start"
      >
        <ChevronFirst className="h-4 w-4" />
      </button>

      {/* Step back */}
      <button
        onClick={() => onStepChange(Math.max(0, currentStep - 1))}
        disabled={currentStep === 0}
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 transition-colors"
        title="Step back"
      >
        <SkipBack className="h-4 w-4" />
      </button>

      {/* Play / Pause / Replay */}
      <button
        onClick={onPlayPause}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        title={isAtEnd ? 'Replay' : isPlaying ? 'Pause' : 'Play'}
      >
        {isAtEnd ? (
          <RotateCcw className="h-3.5 w-3.5" />
        ) : isPlaying ? (
          <Pause className="h-3.5 w-3.5" />
        ) : (
          <Play className="h-3.5 w-3.5 ml-0.5" />
        )}
      </button>

      {/* Step forward */}
      <button
        onClick={() => onStepChange(Math.min(totalSteps, currentStep + 1))}
        disabled={isAtEnd}
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 transition-colors"
        title="Step forward"
      >
        <SkipForward className="h-4 w-4" />
      </button>

      {/* Jump to end */}
      <button
        onClick={() => onStepChange(totalSteps)}
        disabled={isAtEnd}
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 transition-colors"
        title="Jump to end"
      >
        <ChevronLast className="h-4 w-4" />
      </button>

      {/* Step counter */}
      <div className="mx-1 text-xs text-muted-foreground tabular-nums">
        Step {currentStep} of {totalSteps}
      </div>

      {/* Speed control */}
      <button
        onClick={cycleSpeed}
        className="rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors tabular-nums"
        title="Change speed"
      >
        {speed}x
      </button>
    </div>
  );
}
