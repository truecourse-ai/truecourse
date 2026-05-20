export class UtilityRegistry {
  private readonly id: string;

  private constructor(id: string) {
    this.id = id;
  }

  public static create(label: string): UtilityRegistry {
    return new UtilityRegistry(label);
  }

  public describe(): string {
    return `registry(${this.id})`;
  }
}
