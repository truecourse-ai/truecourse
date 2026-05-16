function expectsNumber_f1fd9c6c(x: number): number { return x * 2; }
export function caller_f1fd9c6c(): number {
  return expectsNumber_f1fd9c6c("not a number" as unknown as number);
}
