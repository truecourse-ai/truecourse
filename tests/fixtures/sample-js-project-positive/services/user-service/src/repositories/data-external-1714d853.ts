export async function fetchUserData_1714d853(id: string): Promise<unknown> {
  const response = await fetch(`https://external.api.example.com/users/${id}`);
  return response.json();
}
