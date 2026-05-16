declare const axios: { get: (url: string) => Promise<unknown> };

export class ExternalUserRepository {
  async fetchUser(id: string): Promise<unknown> {
    const response = await axios.get(`https://external.example.com/users/${id}`);
    return response;
  }
}
