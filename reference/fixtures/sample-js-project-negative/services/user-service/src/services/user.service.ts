import { UserRepository } from '../repositories/user.repository';

const repo = new UserRepository();

export class UserService {
  // VIOLATION: code-quality/deterministic/missing-return-type
  // VIOLATION: code-quality/deterministic/static-method-candidate
  // VIOLATION: code-quality/deterministic/require-await
  async getAll() {
    return repo.findAll();
  }

  // VIOLATION: code-quality/deterministic/missing-return-type
  // VIOLATION: code-quality/deterministic/static-method-candidate
  // VIOLATION: code-quality/deterministic/require-await
  async getById(id: string) {
    return repo.findById(id);
  }

  // VIOLATION: code-quality/deterministic/missing-return-type
  // VIOLATION: code-quality/deterministic/static-method-candidate
  // VIOLATION: code-quality/deterministic/require-await
  async create(data: { name: string; email: string }) {
    return repo.create(data);
  }

  // VIOLATION: code-quality/deterministic/missing-return-type
  // VIOLATION: code-quality/deterministic/static-method-candidate
  // VIOLATION: code-quality/deterministic/require-await
  async delete(id: string) {
    return repo.delete(id);
  }
}
