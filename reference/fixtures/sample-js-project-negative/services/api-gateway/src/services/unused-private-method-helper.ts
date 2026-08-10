export class StringFormatter {
  // VIOLATION: code-quality/deterministic/unused-private-method
  private appendSuffix(input: string): string {
    return `${input}-x`;
  }

  public format(input: string): string {
    return input.trim().toLowerCase();
  }
}
