export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// VIOLATION: architecture/deterministic/dead-method
// VIOLATION: architecture/deterministic/unused-export
export function validateName(name: string): boolean {
  return name.length >= 2 && name.length <= 100;
}
