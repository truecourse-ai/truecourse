// VIOLATION: code-quality/deterministic/unused-private-member
class CounterBox {
  private static _ghost: CounterBox;
  private count = 0;

  bump(): number {
    return ++this.count;
  }
}

export const sharedBox = new CounterBox();
