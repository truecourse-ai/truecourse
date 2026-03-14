'use client';

import { AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

type WarningCardProps = {
  severity: string;
  message: string;
};

const severityIcons: Record<string, React.ElementType> = {
  critical: AlertTriangle,
  high: AlertTriangle,
  medium: AlertCircle,
  low: Info,
  info: Info,
};

const severityStyles: Record<string, string> = {
  critical: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
  high: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20',
  medium: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20',
  low: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20',
  info: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
};

export function WarningCard({ severity, message }: WarningCardProps) {
  const Icon = severityIcons[severity] || Info;
  const styles = severityStyles[severity] || severityStyles.info;

  return (
    <Alert className={`px-2.5 py-1.5 ${styles}`}>
      <Icon className="h-3.5 w-3.5 flex-shrink-0" />
      <AlertDescription className="text-[11px] font-medium leading-tight text-current">
        {message}
      </AlertDescription>
    </Alert>
  );
}
