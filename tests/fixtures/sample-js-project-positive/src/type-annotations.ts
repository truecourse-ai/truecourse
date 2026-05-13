/**
 * Type annotations that should NOT trigger duplicate-string or magic-string.
 *
 * - Interfaces with primitive type names (string, number, boolean) are in type_annotation
 *   context, which both magic-string and duplicate-string skip
 * - Union types and type aliases similarly live in type contexts
 * - Literal types in unions are skipped by both rules
 */

// Interfaces with primitive types — no magic-string or duplicate-string
export interface UserProfile {
  id: string;
  name: string;
  email: string;
  age: number;
  active: boolean;
}

export interface ApiResponse {
  status: string;
  message: string;
  data: unknown;
  timestamp: number;
}

// Union types — literal_type context is skipped
export type Status = 'active' | 'inactive' | 'pending' | 'archived';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Type aliases with complex types
export type Handler = (request: unknown, response: unknown) => Promise<void>;

export type EventMap = Record<string, (...args: readonly unknown[]) => void>;

// Discriminated union
export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string };

// Mapped type
export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P];
};

// Generic interface
export interface Repository<T> {
  findById(id: string): Promise<T | null>;
  findAll(): Promise<T[]>;
  create(data: Partial<T>): Promise<T>;
  update(id: string, data: Partial<T>): Promise<T>;
  remove(id: string): Promise<void>;
}

// Using the types to ensure they are exported and used
export function createResponse(status: Status, message: string): ApiResponse {
  return {
    status,
    message,
    data: null,
    timestamp: Date.now(),
  };
}
