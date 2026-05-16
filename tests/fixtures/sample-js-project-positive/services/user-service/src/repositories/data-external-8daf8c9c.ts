export async function fetchUserData_8daf8c9c(id: string): Promise<unknown> {
  const response = await fetch(`https://external.api.example.com/users/${id}`);
  return response.json();
}
