import { UserRepository } from '../repositories/user.repository';

const repo = new UserRepository();

export class UserService {
  async getAll() {
    return repo.findAll();
  }

  async getById(id: string) {
    return repo.findById(id);
  }

  async create(data: { name: string; email: string }) {
    return repo.create(data);
  }

  async delete(id: string) {
    return repo.delete(id);
  }
}
