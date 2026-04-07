import { config } from '../config';
import { formatUser } from '@sample/shared-utils';

interface UserData {
  name: string;
  email: string;
}

interface RawUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

interface FormattedUser {
  id: string;
  name: string;
  email: string;
  displayName: string;
  createdAt: string;
}

const TIMEOUT_MS = 10_000;

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  return response.json();
}

async function postJson(url: string, body: UserData): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return response.json();
}

async function deleteUrl(url: string): Promise<void> {
  await fetch(url, { method: 'DELETE', signal: AbortSignal.timeout(TIMEOUT_MS) });
}

function toRawUser(data: unknown): RawUser {
  const obj = data as Record<string, unknown>;
  return {
    id: String(obj.id ?? ''),
    name: String(obj.name ?? ''),
    email: String(obj.email ?? ''),
    createdAt: String(obj.createdAt ?? ''),
  };
}

function toRawUserList(data: unknown): RawUser[] {
  const empty: RawUser[] = [];
  if (!Array.isArray(data)) return empty;
  return data.map(toRawUser);
}

export class UserService {
  private readonly baseUrl = config.userServiceUrl;

  async findAll(): Promise<FormattedUser[]> {
    const raw = await fetchJson(`${this.baseUrl}/users`);
    return toRawUserList(raw).map(formatUser);
  }

  async findById(id: string): Promise<FormattedUser> {
    const raw = await fetchJson(`${this.baseUrl}/users/${id}`);
    return formatUser(toRawUser(raw));
  }

  async create(userData: UserData): Promise<FormattedUser> {
    const raw = await postJson(`${this.baseUrl}/users`, userData);
    return formatUser(toRawUser(raw));
  }

  async handleRemove(id: string): Promise<void> {
    await deleteUrl(`${this.baseUrl}/users/${id}`);
  }
}
