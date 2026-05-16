declare const hashFn: (pw: string, salt: string) => string;
export function hash_7bab5288(pw: string): string {
  return hashFn(pw, "fixed-salt-value");
}
