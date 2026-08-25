// True bug pattern: a private field is set once via an inline
// initializer or in the constructor and is never reassigned again
// anywhere in the class. It should carry `readonly` to signal that.

export class RateLimiter {
  // VIOLATION: code-quality/deterministic/mutable-private-member
  private maxPerWindow = 250;

  isOver(count: number): boolean {
    return count > this.maxPerWindow;
  }
}

export class Greeter {
  // VIOLATION: code-quality/deterministic/mutable-private-member
  private greeting: string;

  constructor(greeting: string) {
    this.greeting = greeting;
  }

  say(name: string): string {
    return `${this.greeting}, ${name}`;
  }
}
