/**
 * Folder-level barrel — re-exports the components in this folder.
 *
 * Despite being named `index.ts`, this is NOT a Node.js process entry point
 * (it has no `.listen(...)`, `process.argv`, etc.). The
 * `uncaught-exception-no-handler` rule must not fire on UI-layer barrels
 * inside `components/`, `routes/`, `pages/`, etc.
 */

export { Dashboard } from './Dashboard';
export { NotificationList } from './NotificationList';
export { UserForm } from './UserForm';
