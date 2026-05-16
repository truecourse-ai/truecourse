/**
 * Form wrapper component — exercises the duplicate-import TP shape where
 * two `import type` declarations target the same module (default type
 * import + named type import).
 */

import type ReactNS from 'react';
// VIOLATION: bugs/deterministic/duplicate-import
import type { FormHTMLAttributes } from 'react';

declare function cn(...classes: string[]): string;

export type FormWrapperProps = FormHTMLAttributes<HTMLFormElement> & {
  children?: ReactNS.ReactNode;
  heading?: string;
};

export const FormWrapper = ({
  children,
  heading,
  className,
  ...rest
}: FormWrapperProps) => {
  return (
    <form
      className={cn(
        'flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm',
        className ?? '',
      )}
      {...rest}
    >
      {heading && (
        <h2 className="text-lg font-semibold text-gray-900">{heading}</h2>
      )}
      {children}
    </form>
  );
};
