export function formatUser(user: any) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    displayName: `${user.name} <${user.email}>`,
    createdAt: new Date(user.createdAt).toISOString(),
  };
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]!;
}
