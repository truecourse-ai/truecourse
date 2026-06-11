// Positive: code-quality/deterministic/public-static-readonly
//
// A public static field with no initializer is a late-bound slot — it is
// assigned later by a consumer or in a static initializer, not a compile-time
// constant. It cannot be `readonly`, because a readonly field must be given
// its value at declaration. The rule should only flag static fields that
// actually hold a constant initializer.

interface MetricSink {
  write(line: string): void;
}

export class Telemetry {
  // Assigned by the host application after construction.
  static onFlush: (count: number) => void;
  static sink: MetricSink;

  private readonly label: string;

  constructor(label: string) {
    this.label = label;
  }

  describe(): string {
    return this.label;
  }
}
