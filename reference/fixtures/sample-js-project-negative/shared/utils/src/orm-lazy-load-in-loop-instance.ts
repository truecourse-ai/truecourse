import { BaseModel as _BaseModel } from '@adonisjs/lucid/orm';

interface User {
  related(name: string): Promise<unknown>;
}

export async function loadRelated(users: ReadonlyArray<User>): Promise<void> {
  for (const user of users) {
    // VIOLATION: database/deterministic/orm-lazy-load-in-loop
    await user.related('posts');
  }
}
