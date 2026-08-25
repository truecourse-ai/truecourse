// VIOLATION: architecture/deterministic/god-module
// Service class with too many unrelated responsibilities. Should be split
// into smaller focused services (CRUD, lifecycle, notifications, etc.).

type Task = { id: string; title: string; status: string; ownerId: string };
type Store = Map<string, Task>;

export class TaskHandlers {
  constructor(private readonly store: Store) {}

  createTask(id: string, title: string, ownerId: string): Task {
    const task: Task = { id, title, status: 'open', ownerId };
    this.store.set(id, task);
    return task;
  }

  getTask(id: string): Task | undefined {
    return this.store.get(id);
  }

  updateTitle(id: string, title: string): void {
    const t = this.store.get(id);
    if (t) t.title = title;
  }

  deleteTask(id: string): void {
    this.store.delete(id);
  }

  closeTask(id: string): void {
    const t = this.store.get(id);
    if (t) t.status = 'closed';
  }

  reopenTask(id: string): void {
    const t = this.store.get(id);
    if (t) t.status = 'open';
  }

  archiveTask(id: string): void {
    const t = this.store.get(id);
    if (t) t.status = 'archived';
  }

  assignOwner(id: string, ownerId: string): void {
    const t = this.store.get(id);
    if (t) t.ownerId = ownerId;
  }

  listOpen(): Task[] {
    return [...this.store.values()].filter(t => t.status === 'open');
  }

  listClosed(): Task[] {
    return [...this.store.values()].filter(t => t.status === 'closed');
  }

  listArchived(): Task[] {
    return [...this.store.values()].filter(t => t.status === 'archived');
  }

  listByOwner(ownerId: string): Task[] {
    return [...this.store.values()].filter(t => t.ownerId === ownerId);
  }

  countOpen(): number {
    return this.listOpen().length;
  }

  countClosed(): number {
    return this.listClosed().length;
  }

  countArchived(): number {
    return this.listArchived().length;
  }

  exportAll(): Task[] {
    return [...this.store.values()];
  }

  importAll(tasks: Task[]): void {
    for (const t of tasks) this.store.set(t.id, t);
  }

  clear(): void {
    this.store.clear();
  }
}
