
declare function clsx(...inputs: Array<string | undefined | null | boolean | Record<string, boolean>>): string;
declare function twMerge(...classes: string[]): string;

function cn(...inputs: Array<string | undefined | null | boolean | Record<string, boolean>>) {
  return twMerge(clsx(...inputs));
}
