export async function fetchUserData_7e0fb6f3(id: string): Promise<unknown> {
  const response = await fetch(`https://external.api.example.com/users/${id}`);
  return response.json();
}
