export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
  return emailRegex.test(email);
}

export function validateName(name: string): boolean {
  return name.length >= 2 && name.length <= 100;
}
