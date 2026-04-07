interface RawUser {
  id: string;
  name: string;
  email: string;
  createdAt: string | Date;
}

export function formatUser(user: RawUser): { id: string; name: string; email: string; displayName: string; createdAt: string } {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    displayName: `${user.name} <${user.email}>`,
    createdAt: new Date(user.createdAt).toISOString(),
  };
}

export function formatDate(date: Date): string {
  const parts = date.toISOString().split('T');
  return parts[0] ?? '';
}
