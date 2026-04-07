import axios from 'axios';
import { formatUser } from '@sample/shared-utils';

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3001';

export class UserService {
  async findAll() {
    const response = await axios.get(`${USER_SERVICE_URL}/users`);
    return response.data.map(formatUser);
  }

  async findById(id: string) {
    const response = await axios.get(`${USER_SERVICE_URL}/users/${id}`);
    return formatUser(response.data);
  }

  async create(data: { name: string; email: string }) {
    const response = await axios.post(`${USER_SERVICE_URL}/users`, data);
    return formatUser(response.data);
  }

  async delete(id: string) {
    await axios.delete(`${USER_SERVICE_URL}/users/${id}`);
  }
}
