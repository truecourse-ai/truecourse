export async function fetchUserData_23cc199f(id: string): Promise<unknown> {
  const response = await fetch(`https://external.api.example.com/users/${id}`);
  return response.json();
}
