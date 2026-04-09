import axios from 'axios';
import { formatUser } from '@sample/shared-utils';

// NOTE: code-quality/deterministic/env-in-library-code — skipped for non-packages files
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3001';

export class UserService {
  // VIOLATION: code-quality/deterministic/missing-return-type
  // VIOLATION: code-quality/deterministic/static-method-candidate
  async findAll() {
    // VIOLATION: reliability/deterministic/http-call-no-timeout
    const response = await axios.get(`${USER_SERVICE_URL}/users`);
    return response.data.map(formatUser);
  }

  // VIOLATION: code-quality/deterministic/missing-return-type
  // VIOLATION: code-quality/deterministic/static-method-candidate
  async findById(id: string) {
    // VIOLATION: reliability/deterministic/http-call-no-timeout
    const response = await axios.get(`${USER_SERVICE_URL}/users/${id}`);
    return formatUser(response.data);
  }

  // VIOLATION: code-quality/deterministic/missing-return-type
  // VIOLATION: code-quality/deterministic/static-method-candidate
  async create(data: { name: string; email: string }) {
    // VIOLATION: reliability/deterministic/http-call-no-timeout
    const response = await axios.post(`${USER_SERVICE_URL}/users`, data);
    return formatUser(response.data);
  }

  // VIOLATION: code-quality/deterministic/missing-return-type
  // VIOLATION: code-quality/deterministic/static-method-candidate
  async delete(id: string) {
    // VIOLATION: reliability/deterministic/http-call-no-timeout
    await axios.delete(`${USER_SERVICE_URL}/users/${id}`);
  }
}
