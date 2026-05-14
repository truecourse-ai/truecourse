'use client';
export function Button(): JSX.Element {
  return <button type="button" className="inline-flex items-center">Click</button>;
}
export function Card(): JSX.Element {
  return <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"><h3 className="text-lg font-semibold">Title</h3></div>;
}
export function CloseIcon(): JSX.Element {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /></svg>;
}
export function Badge(): JSX.Element {
  return <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">badge</span>;
}



// FP shape 03b6cc3cc966: JSX with cn-computed className — no type mismatch
declare function cn(...args: (string | undefined | null | boolean)[]): string;
declare const overlayClass: string | undefined;

function ModalOverlay({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className={cn('fixed inset-0 bg-black/50 z-50', overlayClass)}>
      {children}
    </div>
  );
}



// FP shape 048bcee19a07: cn() with template literal and function result — no type mismatch
declare function cn(...args: (string | undefined | null | boolean)[]): string;
enum ActivityType { LOGIN = 'LOGIN', LOGOUT = 'LOGOUT', UPDATE = 'UPDATE' }
declare function getActivityIndicatorClass(type: ActivityType): string;
declare const activityType: ActivityType;

function ActivityBadge(): JSX.Element {
  return (
    <span
      className={cn(`activity-badge`, getActivityIndicatorClass(activityType))}
    />
  );
}



// FP shape 05a5550f1a4d: cn() with string literal in JSX className — no type mismatch
declare function cn(...args: (string | undefined | null | boolean)[]): string;

function DropdownMenu(): JSX.Element {
  return (
    <div className={cn('absolute top-full left-0 flex justify-center')}>
      <ul className="shadow-lg rounded-md bg-white">
        <li className="px-4 py-2 hover:bg-gray-50">Option 1</li>
        <li className="px-4 py-2 hover:bg-gray-50">Option 2</li>
      </ul>
    </div>
  );
}



// --- FP shape 1bc4bac8835a: cn() with static class and className prop ---
declare function cn(...inputs: Array<string | undefined | null | boolean>): string;

interface FormContainerProps {
  className?: string;
  children?: React.ReactNode;
}

function AuthFormContainer({ className, children }: FormContainerProps): React.ReactElement {
  return (
    <div className={cn('flex flex-col items-center gap-y-8 px-6 py-12', className)}>
      {children}
    </div>
  );
}



// --- FP shape 1d11eb27f1c4: cn() with conditional ternary argument ---
declare function cn2(...inputs: Array<string | undefined | null | boolean>): string;

interface ScrollableTableProps {
  children?: React.ReactNode;
  fixedHeight?: boolean;
}

function ScrollableTable({ children, fixedHeight = false }: ScrollableTableProps): React.ReactElement {
  return (
    <div className={cn2('w-full border rounded', fixedHeight ? 'overflow-hidden' : 'overflow-auto')}>
      <table className="w-full">{children}</table>
    </div>
  );
}



// H01: cn() with variant result — no type mismatch
declare function cn(...args: (string | undefined | false | null)[]): string;
declare function bannerVariants(opts: { variant?: string; size?: string }): string;
declare const React: { forwardRef: <T, P>(render: (props: P, ref: React.Ref<T>) => JSX.Element | null) => React.ForwardRefExoticComponent<P & React.RefAttributes<T>>; HTMLAttributes: <T>() => unknown };
declare namespace React { type Ref<T> = any; type ForwardRefExoticComponent<P> = any; type HTMLAttributes<T> = any; }

const Banner = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { variant?: string; size?: string }
>(({ className, variant, size, ...props }, ref) => (
  <div ref={ref} className={cn('flex items-center gap-2', bannerVariants({ variant, size }), className)} {...props} />
));



// FP shape: cn() Tailwind class merge with className prop; no type mismatch
declare function cn(...args: (string | undefined)[]): string;

function Badge({ className }: { className?: string }) {
  return (
    <span className={cn('absolute top-0 right-0', className)}>
      new
    </span>
  );
}



// FP shape: cn(buttonVariants(), className) in forwardRef; no type mismatch
declare function cn(...args: (string | undefined)[]): string;
declare function buttonVariants(opts?: { variant?: string }): string;

const ConfirmButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }
>(({ className, variant, ...props }, ref) => (
  <button
    ref={ref}
    className={cn(buttonVariants({ variant }), className)}
    {...props}
  />
));
ConfirmButton.displayName = 'ConfirmButton';



// FP shape: cn() Tailwind merge inside forwardRef; no type mismatch
declare function cn(...args: (string | undefined)[]): string;

const LoadingSpinner = React.forwardRef<
  HTMLDivElement,
  { className?: string; size?: 'sm' | 'md' | 'lg' }
>(({ className, size = 'md' }, ref) => (
  <div
    ref={ref}
    className={cn('flex items-center justify-center animate-spin', className)}
    aria-label="Loading"
  />
));
LoadingSpinner.displayName = 'LoadingSpinner';



// FP shape: cn() with string and className from HTMLAttributes; no type mismatch
declare function cn(...args: (string | undefined)[]): string;

function StatusPill({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn('flex items-center gap-1 text-sm', className)}>
      {status}
    </span>
  );
}



// FP shape: cn(variantFn({variant, size, className})) — cn() with cva result is correct
declare function cn(...inputs: string[]): string;
declare function badgeVariants(opts: { variant?: string; size?: string; className?: string }): string;
declare const variant: string;
declare const size: string;
declare const className: string;

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className={cn(badgeVariants({ variant, size, className }))}>
      {children}
    </span>
  );
}



// cn utility with conditional class patterns
declare function cn(...classes: unknown[]): string;

export function CollapsiblePanel({ isCollapsed }: { isCollapsed: boolean }): JSX.Element {
  return (
    <div className={cn('flex flex-1 flex-col overflow-hidden py-4', isCollapsed && 'invisible w-0')}>
      <h2 className="text-lg font-semibold">Panel Content</h2>
      <p className="text-sm text-gray-600">This panel collapses when minimized</p>
    </div>
  );
}

export function SidebarNav({ isMinimized }: { isMinimized: boolean }): JSX.Element {
  return (
    <aside className={cn('bg-gray-100 border-r transition-all duration-300', isMinimized && 'w-12 opacity-50')}>
      <nav className={cn('flex flex-col gap-2 p-4', isMinimized && 'hidden')}>
        <a href="#">Home</a>
        <a href="#">Settings</a>
      </nav>
    </aside>
  );
}

export function ModalOverlay({ isVisible, onClose }: { isVisible: boolean; onClose: () => void }): JSX.Element {
  return (
    <div className={cn('fixed inset-0 bg-black/50 transition-opacity', isVisible && 'opacity-100')}>
      <div className="flex items-center justify-center h-full">
        <div className={cn('bg-white rounded-lg shadow-xl p-6 transition-transform', !isVisible && 'scale-95')}>
          <h3 className="text-xl font-bold mb-4">Modal Title</h3>
          <p>Modal content goes here</p>
          <button onClick={onClose} className={cn('mt-4 px-4 py-2 rounded', isVisible && 'bg-blue-500 text-white')}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function AlertBanner({ isDismissed, variant }: { isDismissed: boolean; variant: string }): JSX.Element {
  return (
    <div className={cn('p-4 rounded border', isDismissed && 'hidden', variant === 'error' && 'bg-red-50 border-red-200')}>
      <p className="text-sm">Important notification</p>
    </div>
  );
}



// Positive: cn() className utility accepts string | undefined
declare function cn(...classes: (string | undefined)[]): string;

interface AlertProps {
  className?: string;
  message: string;
}

export function Alert({ className, message }: AlertProps): JSX.Element {
  return (
    <div className={cn(className)}>
      <p>{message}</p>
    </div>
  );
}



// cn() utility for conditional class merging
declare function cn(...classes: (string | undefined | null | boolean)[]): string;

interface StatusIconProps {
  isActive: boolean;
}

export function StatusIcon({ isActive }: StatusIconProps): JSX.Element {
  return (
    <svg 
      className={cn('h-5 w-5 text-gray-400', isActive ? 'opacity-100' : 'opacity-30')}
      fill="currentColor"
      viewBox="0 0 20 20"
    >
      <circle cx="10" cy="10" r="8" />
    </svg>
  );
}

interface ToggleBadgeProps {
  visible: boolean;
  count: number;
}

export function ToggleBadge({ visible, count }: ToggleBadgeProps): JSX.Element {
  return (
    <span 
      className={cn('inline-flex rounded-full px-2 py-1 text-xs', visible ? 'opacity-100' : 'opacity-0')}
    >
      {count}
    </span>
  );
}



// Classname utility for conditional styling
declare function classNames(...classes: (string | undefined | null | false)[]): string;

export function StatusIcon({ isActive }: { isActive: boolean }): JSX.Element {
  return (
    <svg 
      className={classNames('h-5 w-5', isActive ? 'text-green-500' : 'text-gray-400')}
      fill="none"
      viewBox="0 0 24 24"
    >
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function ListItem({ items, selectedId }: { items: Array<{ id: string; label: string }>; selectedId: string }): JSX.Element {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li 
          key={item.id}
          className={classNames('px-4 py-2 rounded', item.id === selectedId ? 'bg-blue-100' : 'bg-gray-50')}
        >
          {item.label}
        </li>
      ))}
    </ul>
  );
}



// Shape: cn() call with className prop and string argument — both are valid cn() arguments
declare function cn(...args: (string | undefined | null | boolean | Record<string, boolean>)[]): string;

function DocumentViewer({ className, isLoading }: { className?: string; isLoading?: boolean }) {
  return (
    <div
      className={cn(
        'h-full w-full max-w-4xl overflow-hidden rounded-lg border',
        isLoading && 'animate-pulse opacity-50',
        className,
      )}
    >
      <span>viewer</span>
    </div>
  );
}



// Shape 650e858ac534: cn() className combining multiple string class arguments.
declare function cn(...classes: Array<string | boolean | undefined | null>): string;
declare const className: string | undefined;

function AvatarContainer({ size, variant, className: extraClass }: { size: 'sm' | 'md' | 'lg'; variant: 'circle' | 'square'; className?: string }): JSX.Element {
  return (
    <div
      className={cn(
        'inline-flex items-center justify-center overflow-hidden',
        size === 'sm' && 'h-8 w-8 text-sm',
        size === 'md' && 'h-10 w-10 text-base',
        size === 'lg' && 'h-14 w-14 text-lg',
        variant === 'circle' && 'rounded-full',
        variant === 'square' && 'rounded-md',
        extraClass,
      )}
    />
  ) as unknown as JSX.Element;
}



// Shape 6da3822bb855: cn() with static and dynamic className strings — valid classname merge
declare function cn(...classes: (string | undefined | false | null)[]): string;
declare const overlayClassName: string | undefined;

function AnimatedOverlay({ className }: { className?: string }) {
  return (
    <div className={cn('relative mx-auto h-36 w-56 overflow-hidden', className)}>
      <div className="pointer-events-none absolute z-50 transition-all duration-1000 ease-in-out" />
    </div>
  );
}



// Shape 6e294b333872: cn() wrapper div with absolute positioning and optional className — valid classname merge
declare function cn(...classes: (string | undefined | false | null)[]): string;

function ColorPickerPanel({ className }: { className?: string }) {
  return (
    <div className={cn('absolute top-2 right-2 text-foreground', className)}>
      <select defaultValue="black">
        <option value="black">Black</option>
        <option value="blue">Blue</option>
      </select>
    </div>
  );
}



// Shape 7341917f0771: cn() with conditional classes — valid Tailwind merge call
declare function cn(...classes: (string | boolean | undefined | null)[]): string;
declare const isSelected: boolean;
declare const isDisabled: boolean;

function FieldCard({ isSelected, isDisabled }: { isSelected: boolean; isDisabled: boolean }) {
  return (
    <div
      className={cn(
        'pointer-events-none fixed z-50 flex cursor-pointer flex-col items-center justify-center transition duration-200',
        {
          'opacity-50 scale-90': isDisabled,
          'ring-2 ring-blue-500': isSelected,
        },
      )}
    />
  );
}



// FP shape 915d0afacf83: cn() with multiple string args in JSX className — no type mismatch
declare function cn(...args: (string | undefined | null | boolean)[]): string;

interface TabsGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

function TabsGroup({ children, className, ...props }: TabsGroupProps) {
  return (
    <div className={cn('flex flex-wrap border-b border-border', className)} role="tablist" {...props}>
      {children}
    </div>
  );
}



// FP shape 91f7a6cc7420: cn() with CVA variant result and optional className — no type mismatch
declare function panelVariants(opts: { side?: 'left' | 'right'; size?: 'sm' | 'lg' }): string;

interface SlidePanelProps extends React.HTMLAttributes<HTMLDivElement> {
  side?: 'left' | 'right';
  size?: 'sm' | 'lg';
  children: React.ReactNode;
}

const SlidePanel = React.forwardRef<HTMLDivElement, SlidePanelProps>(
  ({ side = 'right', size = 'sm', className, children, ...props }, ref) => (
    <div ref={ref} className={cn(panelVariants({ side, size }), className)} {...props}>
      {children}
    </div>
  ),
);
SlidePanel.displayName = 'SlidePanel';



// FP shape 93ebc1c6bcdc: cn() with conditional opacity class — idiomatic cn() usage, no type mismatch
interface OptionItemProps {
  label: string;
  selected: boolean;
  onSelect: () => void;
}

function OptionItem({ label, selected, onSelect }: OptionItemProps) {
  return (
    <button type="button" onClick={onSelect} className="flex items-center gap-2 px-3 py-2">
      <span className={cn('h-4 w-4 rounded-full', selected ? 'opacity-100 bg-primary' : 'opacity-0')} />
      {label}
    </button>
  );
}



// --- FP shape: cn() called with string literal and className prop ---
declare function cn(...args: Array<string | undefined | false | null>): string;

interface NavContainerProps {
  className?: string;
  [key: string]: unknown;
}
declare const props: NavContainerProps;
const { className, ...rest } = props;

const containerClass = cn('flex flex-col gap-y-2', className);



// --- FP shape: cn() with single className arg passed to element ---
declare function cn2(...args: Array<string | undefined | false | null>): string;

interface SkeletonProps { className?: string }
declare const skeletonProps: SkeletonProps;

const skeletonClass = cn2('animate-pulse rounded-md bg-muted', skeletonProps.className);



// --- FP shape: cva variant function called with object including cn() result ---
declare function cn3(...args: Array<string | undefined | false | null>): string;
declare function tooltipVariants(opts: { color?: string; className?: string }): string;
declare const color: string | undefined;
declare const tooltipClassName: string | undefined;

const variantClass = tooltipVariants({ color, className: cn3(tooltipClassName, 'z-40') });



// Utility for merging class names
declare function cn(...classes: (string | undefined | null | false)[]): string;

interface AlertProps {
  message: string;
  className?: string;
}

export function Alert({ message, className }: AlertProps): JSX.Element {
  return (
    <div role="alert" className={cn('rounded-md border p-4', className)}>
      {message}
    </div>
  );
}

interface CardProps {
  title: string;
  children: React.ReactNode;
  className?: string;
}

export function CardContainer({ title, children, className }: CardProps): JSX.Element {
  return (
    <div className={cn('bg-white shadow-sm rounded-lg p-6', className)}>
      <h2 className="text-xl font-bold mb-4">{title}</h2>
      {children}
    </div>
  );
}

interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'bordered';
}

export function Panel({ variant = 'default', className, children, ...props }: PanelProps): JSX.Element {
  return (
    <div 
      role="region" 
      className={cn(
        'p-4 rounded',
        variant === 'bordered' && 'border border-gray-300',
        className
      )} 
      {...props}
    >
      {children}
    </div>
  );
}



// Utility for conditional classnames
declare function cn(...classes: (string | boolean | undefined)[]): string;

export function StatusIndicator(props: {isOnline: boolean}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className={cn('text-xs', props.isOnline ? 'text-green-600' : 'text-gray-400')}>
        {props.isOnline ? 'Online' : 'Offline'}
      </span>
    </div>
  );
}

export function TabButton(props: {isSelected: boolean; label: string}): JSX.Element {
  return (
    <button
      className={cn(
        'rounded-md px-4 py-2 transition-colors',
        props.isSelected ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      )}
    >
      <span className={cn('font-medium', props.isSelected ? 'text-sm' : 'text-xs')}>
        {props.label}
      </span>
    </button>
  );
}

export function AlertBanner(props: {severity: string}): JSX.Element {
  const isError = props.severity === 'error';
  return (
    <div className={cn('rounded border p-4', isError ? 'border-red-300 bg-red-50' : 'border-blue-300 bg-blue-50')}>
      <p className={cn('text-sm', isError ? 'text-red-800' : 'text-blue-800')}>
        Message content
      </p>
    </div>
  );
}



// cn utility for merging classNames
declare function cn(...classes: (string | undefined | null | boolean)[]): string;

interface PanelProps {
  className?: string;
  children?: React.ReactNode;
}

export function Panel({ className, children }: PanelProps): JSX.Element {
  return (
    <div className={cn('rounded border bg-white p-4', className)}>
      {children}
    </div>
  );
}

interface AlertBoxProps {
  className?: string;
  variant?: 'info' | 'warning';
}

export function AlertBox({ className, variant = 'info' }: AlertBoxProps): JSX.Element {
  return (
    <div className={cn('mb-2 flex-shrink-0', className)} role="alert">
      Alert: {variant}
    </div>
  );
}



// FP shape: cn() utility called with string literal and optional className in JSX
declare function cn(...classes: (string | undefined | null | false)[]): string;
declare const containerClassName: string | undefined;

const FormSection = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <div className={cn('space-y-4 rounded-md border p-4', className)}>
    {children}
  </div>
);



// FP shape: cn() called with multiple string literals and a dynamic class variable
declare function cn(...classes: (string | undefined | null | false)[]): string;
declare const avatarClass: string | undefined;

const UserAvatarBadge = ({ children }: { children?: React.ReactNode }) => (
  <div className={cn('h-10 w-10 rounded-full border-2 border-white shadow-md dark:border-border', avatarClass)}>
    {children}
  </div>
);



// FP shape f7a4429d3679: cn() utility with string literal and optional string prop — no type mismatch
declare function cn(...args: (string | undefined | null | boolean)[]): string;
declare const popoverContentClass: string | undefined;

function FilterPopoverContent({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className={cn('z-[9999] w-full p-0', popoverContentClass)}>
      {children}
    </div>
  );
}



// FP shape f816135c735c: cn() with className prop in forwardRef component — no type mismatch
declare function cn(...args: (string | undefined | null | boolean)[]): string;

const VerificationBadge = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('relative w-full max-w-sm md:max-w-md', className)}
    {...props}
  />
));
VerificationBadge.displayName = 'VerificationBadge';



// FP shape f87803b29318: React.forwardRef with cn(), variant, and spread props — no type mismatch
declare function cn(...args: (string | undefined | null | boolean)[]): string;
declare function cva(base: string, opts: object): (variants: object) => string;
declare type VariantProps<T extends (...args: any) => any> = Parameters<T>[0];

const noticeVariants = cva('rounded-md border p-4', {
  variants: {
    variant: { default: 'bg-background', warning: 'border-yellow-400 bg-yellow-50', info: 'border-blue-400 bg-blue-50' },
    padding: { default: 'p-4', compact: 'p-2' },
  },
  defaultVariants: { variant: 'default', padding: 'default' },
});

const Notice = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof noticeVariants>
>(({ className, variant, padding, ...props }, ref) => (
  <div ref={ref} role="note" className={cn('space-y-2', noticeVariants({ variant, padding }), className)} {...props} />
));
Notice.displayName = 'Notice';



// FP shape: Tailwind class string in a single component's cn() call (single-usage-false-trigger)
declare function cn(...classes: (string | undefined | false)[]): string;

function FieldSelectionCard({ isSelected }: { isSelected: boolean }) {
  return (
    <div
      className={cn(
        'flex h-full w-full cursor-pointer items-center justify-center group-disabled:opacity-50',
        isSelected && 'ring-2 ring-primary',
      )}
    >
      <span className="text-sm font-medium">Select</span>
    </div>
  );
}



// FP shape: inset Tailwind class in three parallel UI primitive components (parallel-independent-call-sites)
declare function cn(...args: (string | undefined | false)[]): string;

function MenuSubTrigger({ inset, className }: { inset?: boolean; className?: string }) {
  return (
    <button
      className={cn(
        'flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none',
        inset && 'pl-8',
        className,
      )}
    />
  );
}

function MenuSubContent({ inset, className }: { inset?: boolean; className?: string }) {
  return (
    <div
      className={cn(
        'min-w-[8rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
        inset && 'pl-8',
        className,
      )}
    />
  );
}

function MenuItemLabel({ inset, className }: { inset?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'px-2 py-1.5 text-sm font-semibold text-foreground',
        inset && 'pl-8',
        className,
      )}
    />
  );
}



// FP: JSX return with simple wrapper div structure — not a complex expression
declare function PageHeader(props: { title: string; subtitle?: string; actions?: React.ReactNode }): JSX.Element;
declare const React: { ReactNode: unknown };

function ApiTokensSettingsPage() {
  return (
    <div>
      <PageHeader
        title="API Tokens"
        subtitle="Manage your personal access tokens"
      />
    </div>
  );
}



// FP: JSX return with simple div/h2 wrapper — not a complex expression
function AdminUserDetailSection() {
  return (
    <div>
      <h2 className="font-semibold text-4xl">User Details</h2>
    </div>
  );
}



// FP: JSX return with structural field container element — not a complex expression
declare function SigningFieldContainer(props: { field: unknown; onSign?: () => void; className?: string }): JSX.Element;
declare const numberField: unknown;

function NumberFieldView() {
  return (
    <SigningFieldContainer
      field={numberField}
      className="relative"
    />
  );
}



// FP: JSX return with simple Card element — not a complex expression
declare function Card(props: { backdropBlur?: boolean; className?: string; children?: unknown }): JSX.Element;

function RecipientFormCard() {
  return (
    <Card backdropBlur={false} className="border">
    </Card>
  );
}



// FP: JSX return with structural container and loading conditional — not a complex expression
declare function SigningFieldContainer(props: { field: unknown; isLoading?: boolean; children?: unknown }): JSX.Element;
declare const checkboxField: unknown;
declare const isLoading: boolean;

function CheckboxFieldView() {
  return (
    <SigningFieldContainer
      field={checkboxField}
      isLoading={isLoading}
    />
  );
}



// FP: JSX with two-variable disjunction in conditional rendering — idiomatic
declare const hasFinishedInit: boolean;
declare const hasDocumentLoaded: boolean;

function EmbedTemplateClientPage() {
  return (
    <div>
      {(!hasFinishedInit || !hasDocumentLoaded) && (
        <div className="flex items-center justify-center">
          Loading...
        </div>
      )}
    </div>
  );
}



// FP: JSX Dialog with single-&& guard in onOpenChange prop — idiomatic
declare function Dialog(props: { open: boolean; onOpenChange: (value: boolean) => void; children?: unknown }): JSX.Element;
declare function DialogTrigger(props: { asChild?: boolean; children?: unknown }): JSX.Element;
declare const open: boolean;
declare function setOpen(v: boolean): void;
declare const form: { formState: { isSubmitting: boolean } };

function CreateTeamDialog() {
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => !form.formState.isSubmitting && setOpen(value)}
    >
      <DialogTrigger asChild={true}>
        <button>Create Team</button>
      </DialogTrigger>
    </Dialog>
  );
}



// FP: JSX return with cn() for conditional classes — idiomatic, not a complex expression
declare function cn(...args: unknown[]): string;
declare const isScrolled: boolean;
declare const theme: string;

function AppHeader() {
  return (
    <header className={cn('flex items-center px-4', isScrolled && 'shadow-md', theme === 'dark' && 'bg-gray-900')}>
      <nav>Navigation</nav>
    </header>
  );
}



// FP: JSX return with grid layout div — standard structural element
function ConfigureFieldsGrid() {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div>Field 1</div>
      <div>Field 2</div>
      <div>Field 3</div>
    </div>
  );
}



// FP: JSX structural provider wrapper — not a complex expression
declare function RecipientProvider(props: { recipient: unknown; targetSigner: unknown; children?: unknown }): JSX.Element;
declare const recipient: unknown;
declare const targetSigner: unknown;

function SigningPageView() {
  return (
    <RecipientProvider recipient={recipient} targetSigner={targetSigner}>
      <div>Signing form</div>
    </RecipientProvider>
  );
}



// FP: JSX Dialog with single-&& guard in onOpenChange and asChild — idiomatic
declare function Dialog(props: { open: boolean; onOpenChange: (value: boolean) => void; children?: unknown }): JSX.Element;
declare function DialogTrigger(props: { asChild?: boolean; children?: unknown }): JSX.Element;
declare const isTemplateDialogOpen: boolean;
declare function setTemplateDialogOpen(v: boolean): void;
declare const templateForm: { formState: { isSubmitting: boolean } };

function UseTemplateDialog() {
  return (
    <Dialog
      open={isTemplateDialogOpen}
      onOpenChange={(value) => !templateForm.formState.isSubmitting && setTemplateDialogOpen(value)}
    >
      <DialogTrigger asChild>
        <button>Use Template</button>
      </DialogTrigger>
    </Dialog>
  );
}



// FP: JSX return with div containing a Select component — structural JSX
declare function Select(props: { value: string; onValueChange: (v: string) => void; children?: unknown }): JSX.Element;
declare const shareMode: string;
declare function setShareMode(v: string): void;

function DocumentShareButton() {
  return (
    <div
      className="flex flex-col gap-4"
      data-testid="document-share-button"
    >
      <Select value={shareMode} onValueChange={setShareMode} />
    </div>
  );
}



// JSX div with cn() className and Link children
declare function cn(...classes: string[]): string;
declare const NavLink: React.FC<{ to: string; children: React.ReactNode; className?: string }>;
declare const isActive: boolean;

function NavItem({ label, href }: { label: string; href: string }) {
  return (
    <div className={cn('nav-item', isActive && 'nav-item--active')}>
      <NavLink to={href} className="nav-link">
        {label}
      </NavLink>
    </div>
  );
}



// Simple JSX div wrapper — structural element, not a complex expression
function PageContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-background">
      {children}
    </div>
  );
}



// JSX div with Tailwind layout classes — structural element
function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {children}
    </div>
  );
}



// JSX root div with full-screen Tailwind classes — structural element
declare const AppHeader: React.FC;
declare const AppContent: React.FC;

function AppShell() {
  return (
    <div className="h-screen w-screen bg-editor-background">
      <AppHeader />
      <AppContent />
    </div>
  );
}



export function PlaygroundLayout(): JSX.Element {
  return (
    <div style={{ display: 'flex', height: '100vh', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <span>content</span>
      </div>
    </div>
  );
}



export function DocumentPageView(): JSX.Element {
  return (
    <div className='min-h-screen w-screen bg-gray-50 dark:bg-background'>
      <main className='mx-auto max-w-4xl px-4'>
        <slot />
      </main>
    </div>
  );
}



export function ThemeSwitcher(): JSX.Element {
  return (
    <div className='flex items-center gap-x-1 rounded-full bg-muted p-1'>
      <button type='button' className='rounded-full p-1'>Light</button>
      <button type='button' className='rounded-full p-1'>Dark</button>
    </div>
  );
}



export function EditorHeader(): JSX.Element {
  return (
    <nav className='w-full border-b border-border bg-background px-4 py-2'>
      <div className='flex items-center justify-between'>
        <span className='font-semibold'>Editor</span>
      </div>
    </nav>
  );
}



declare function FormFlowHeader(props: { title: string; description?: string }): JSX.Element;
export function AddSubjectStep(): JSX.Element {
  return (
    <>
      <FormFlowHeader title='Add Subject' description='Enter a subject for this document' />
      <div className='flex flex-col gap-y-4 px-4 py-6'>
        <input type='text' placeholder='Subject' className='w-full rounded border px-3 py-2' />
      </div>
    </>
  );
}



declare function cn(...args: string[]): string;
export function SignupLayout({ className }: { className?: string }): JSX.Element {
  return (
    <div className={cn('flex justify-center min-h-screen bg-gray-50', className ?? '')}>
      <div className='w-full max-w-md p-8'>
        <slot />
      </div>
    </div>
  );
}



export function MobileFloatingWidget(): JSX.Element {
  return (
    <div className='pointer-events-none fixed bottom-4 left-0 right-0 flex justify-center px-4'>
      <div className='pointer-events-auto rounded-full bg-primary px-6 py-3 shadow-lg'>
        <span className='text-sm font-medium text-white'>Sign Document</span>
      </div>
    </div>
  );
}



export function DashboardLayout(): JSX.Element {
  return (
    <div className='mx-auto w-full max-w-screen-xl px-4 py-8'>
      <div className='flex flex-col gap-y-6'>
        <slot />
      </div>
    </div>
  );
}



declare function Button2(props: { type?: string; variant?: string; children: unknown }): JSX.Element;
export function DocumentFlowActions(): JSX.Element {
  return (
    <div className='mt-4 flex gap-x-4'>
      <Button2 type='button' variant='outline'>Previous</Button2>
      <Button2 type='submit'>Next</Button2>
    </div>
  );
}



// JSX with cn() conditional className — triggers expression-complexity FP
declare function cn(...args: unknown[]): string;

function AlertBanner({ message, visible }: { message: string; visible: boolean }) {
  return (
    <div
      className={cn(
        'mb-4 rounded-lg border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-800',
        { hidden: !visible }
      )}
    >
      <p>{message}</p>
    </div>
  );
}



// cn() class string with hyphenated Tailwind token — styling utility call
declare function cn(...args: unknown[]): string;

function FieldCardWrapper({ isSelected }: { isSelected: boolean }) {
  return cn(
    'flex h-full w-full cursor-pointer items-center justify-center',
    isSelected && 'ring-2 ring-primary',
  );
}



// Enum string value compared in Tailwind cn() class object — typed enum in styling context
declare function cn(...args: unknown[]): string;

type SubscriptionStatus = 'ACTIVE' | 'EXPIRED' | 'PAST_DUE' | 'UNAUTHORIZED';

function getSubscriptionBannerClass(subscriptionStatus: SubscriptionStatus | undefined): string {
  return cn('mb-8 rounded-lg bg-yellow-200 text-yellow-900 dark:bg-yellow-400', {
    'bg-destructive text-destructive-foreground':
      subscriptionStatus === 'EXPIRED' || subscriptionStatus === 'UNAUTHORIZED',
  });
}



// --- magic-string FP shape: ui-styling-token (CSS keyword as fallback value) ---
declare function computeFieldHeight(fieldType: string): number | undefined;

function getFieldStyle(fieldType: string): { minHeight: string; overflow: string } {
  const computedHeight = computeFieldHeight(fieldType);
  return {
    minHeight: computedHeight ? `${computedHeight}px` : 'auto',
    overflow: 'hidden',
  };
}



// --- magic-string FP shape: ui-styling-token (cva defaultVariants) ---
declare function cva(base: string, config: {
  variants: Record<string, Record<string, string>>;
  defaultVariants: Record<string, string>;
}): (props?: Record<string, string>) => string;

const drawerVariants = cva('fixed z-50 flex flex-col', {
  variants: {
    position: {
      right: 'inset-y-0 right-0',
      left: 'inset-y-0 left-0',
      top: 'inset-x-0 top-0',
      bottom: 'inset-x-0 bottom-0',
    },
  },
  defaultVariants: { position: 'right' },
});



// --- magic-string FP shape: ui-styling-token (CSS property value in inline style object) ---
type SatoriStyle = { display?: string; flexDirection?: string; width?: string; height?: string; fontFamily?: string; fontSize?: number; color?: string };

function buildOpenGraphImageLayout(title: string, subtitle: string): { type: string; props: { style: SatoriStyle; children: unknown[] } } {
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        fontFamily: 'Inter',
        color: '#111827',
      },
      children: [title, subtitle],
    },
  };
}



// --- magic-string FP shape: ui-styling-token (Tailwind class string in cn() call) ---
declare function cn(...classes: Array<string | undefined | null | false>): string;

function DocumentFieldButton({ disabled, className }: { disabled?: boolean; className?: string }) {
  return {
    className: cn(
      'flex h-full w-full cursor-pointer items-center justify-center group-disabled:opacity-50',
      disabled && 'pointer-events-none opacity-50',
      className,
    ),
  };
}



// --- magic-string FP shape: ui-styling-token (fontFamily design token in style object) ---
type PDFStyle = { fontFamily?: string; fontSize?: number; color?: string; fontWeight?: string };

function buildAuditLogTextStyle(isHeader: boolean): PDFStyle {
  return {
    fontFamily: 'Inter',
    fontSize: isHeader ? 14 : 10,
    fontWeight: isHeader ? 'bold' : 'normal',
    color: isHeader ? '#111827' : '#6b7280',
  };
}



// Tailwind CSS utility classes in conditional className expressions are design-system tokens, not magic strings.
declare function cn(...classes: (string | false | undefined)[]): string;
declare const React: { forwardRef: <T, P>(render: (props: P, ref: T) => null) => unknown };

interface MenuItemProps {
  className?: string;
  inset?: boolean;
  children?: unknown;
}

export const MenuSubTrigger = React.forwardRef<HTMLDivElement, MenuItemProps>((
  { className, inset, children, ...props },
  ref,
) => (
  // @ts-ignore placeholder render
  null
));

function buildMenuItemClassName(inset?: boolean, className?: string): string {
  return cn(
    'flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none',
    inset && 'pl-8',
    className,
  );
}



// 'bg-accent' is a Tailwind CSS design-system token used in a conditional className — not a magic string.
declare function cn(...classes: (string | false | undefined)[]): string;

interface OrgItemProps {
  orgId: number;
  currentOrgId: number | undefined;
  hoveredOrgId: number | null;
}

export function buildOrgItemClassName({ orgId, currentOrgId, hoveredOrgId }: OrgItemProps): string {
  return cn(
    'w-full px-4 py-2 text-muted-foreground',
    orgId === currentOrgId && !hoveredOrgId && 'bg-accent',
    orgId === hoveredOrgId && 'bg-accent',
  );
}
