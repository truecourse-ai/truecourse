export async function fetchUserData_ad37b7af(id: string): Promise<unknown> {
  const response = await fetch(`https://external.api.example.com/users/${id}`);
  return response.json();
}
