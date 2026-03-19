import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { SEVERITY_COLORS } from '@/lib/severity-colors';

type ViolationData = {
  id: string;
  severity: string;
  title: string;
  content?: string;
};

type StepDetailData = {
  methodName: string;
  description: string | null;
  stepType: string;
  dbColor: string | null;
  isAsync: boolean;
  isActive: boolean;
  stepOrder: number;
  violations: ViolationData[];
};

const stepTypeColors: Record<string, string> = {
  call: '#6b7280',
  http: '#3b82f6',
  'db-read': '#22c55e',
  'db-write': '#f59e0b',
  event: '#a855f7',
};

const severityColors = SEVERITY_COLORS;

function StepDetailNodeComponent({ data }: NodeProps) {
  const d = data as unknown as StepDetailData;
  const color = d.dbColor || stepTypeColors[d.stepType] || '#6b7280';

  return (
    <div
      className="flex flex-col items-center gap-0.5 pointer-events-auto w-full"
      style={{ opacity: d.isActive ? 1 : 0.35 }}
    >
      {/* Step number + method name */}
      <div className="flex items-center gap-1">
        <div
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {d.stepOrder}
        </div>
        {d.isAsync && (
          <svg className="shrink-0" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        )}
        <span className="text-[9px] font-semibold text-foreground leading-tight text-center" style={{ wordBreak: 'break-word' }}>
          {d.methodName}
        </span>
      </div>

      {/* Description */}
      {d.description && (
        <p className="text-[8px] leading-tight text-muted-foreground text-center" style={{ wordBreak: 'break-word' }}>
          {d.description}
        </p>
      )}

      {/* Violations */}
      {d.violations.length > 0 && (
        <div className="flex flex-col gap-0.5 mt-0.5" style={{ maxWidth: '80%' }}>
          {d.violations.map((v) => (
            <div key={v.id} className="group/violation relative">
              <div
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[8px] leading-tight border cursor-pointer"
                style={{
                  borderColor: severityColors[v.severity] || '#6b7280',
                  backgroundColor: `${severityColors[v.severity] || '#6b7280'}15`,
                }}
              >
                <svg className="shrink-0" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={severityColors[v.severity] || '#6b7280'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
                  <path d="M12 9v4" />
                  <path d="M12 17h.01" />
                </svg>
                <span className="text-foreground truncate">{v.title}</span>
              </div>
              {/* Hover tooltip — works because this is real DOM */}
              <div className="pointer-events-none absolute left-1/2 bottom-full mb-1 -translate-x-1/2 z-[9999] hidden group-hover/violation:block">
                <div className="rounded-md border border-border bg-card px-2.5 py-2 shadow-lg w-[220px]">
                  <p className="text-[10px] font-semibold mb-0.5" style={{ color: severityColors[v.severity] }}>{v.severity}</p>
                  <p className="text-[10px] text-foreground font-medium leading-tight">{v.title}</p>
                  {v.content && <p className="text-[9px] text-muted-foreground leading-tight mt-0.5">{v.content}</p>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const StepDetailNode = memo(StepDetailNodeComponent);
