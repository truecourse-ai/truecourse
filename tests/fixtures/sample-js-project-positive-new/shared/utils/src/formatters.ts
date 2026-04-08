interface UserInput {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

interface FormattedUser {
  id: string;
  name: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export function formatUser(user: UserInput): FormattedUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    displayName: `${user.name} <${user.email}>`,
    createdAt: new Date(user.createdAt).toISOString(),
  };
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0] ?? '';
}
