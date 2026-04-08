/* Type declarations for external modules used in the fixture */

declare module 'express' {
  interface Request {
    params: Record<string, string>;
    query: Record<string, string | undefined>;
    body: unknown;
    headers: Record<string, string | undefined>;
    ip: string;
    method: string;
    path: string;
    socket: { remoteAddress: string };
  }
  interface Response {
    status(code: number): Response;
    json(body: unknown): Response;
    send(body?: unknown): Response;
    setHeader(name: string, value: string): Response;
    on(event: string, listener: (...args: unknown[]) => void): Response;
    statusCode: number;
  }
  type NextFunction = (err?: unknown) => void;
  type RequestHandler = (req: Request, res: Response, next: NextFunction) => void;
  interface Router {
    get(path: string, ...handlers: RequestHandler[]): Router;
    post(path: string, ...handlers: RequestHandler[]): Router;
    put(path: string, ...handlers: RequestHandler[]): Router;
    route(path: string): Router;
    all(...handlers: RequestHandler[]): Router;
    use(...handlers: (string | RequestHandler)[]): Router;
  }
  function Router(): Router;
  interface Application {
    use(...args: (string | RequestHandler)[]): Application;
    get(path: string, ...handlers: RequestHandler[]): Application;
    post(path: string, ...handlers: RequestHandler[]): Application;
    listen(port: string | number, callback?: () => void): void;
  }
  function express(): Application;
  export default express;
  export { Request, Response, NextFunction, Router, RequestHandler };
}

declare module 'cors' {
  const cors: () => import('express').RequestHandler;
  export default cors;
}

declare module 'helmet' {
  const helmet: () => import('express').RequestHandler;
  export default helmet;
}

declare module 'axios' {
  interface AxiosResponse<T> {
    data: T;
    status: number;
  }
  interface AxiosRequestConfig {
    timeout?: number;
  }
  interface AxiosInstance {
    get<T>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
    post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
  }
  const axios: AxiosInstance;
  export default axios;
}

declare module 'ioredis' {
  class Redis {
    constructor(url: string);
    get(key: string): Promise<string | null>;
    set(key: string, value: string, mode: string, ttl: number): Promise<string>;
  }
  export default Redis;
}

declare module '@prisma/client' {
  interface User {
    id: string;
    name: string;
    email: string;
    archived?: boolean;
  }
  interface UserDelegate {
    findMany(): Promise<User[]>;
    findUnique(args: { where: { id: string } }): Promise<User | null>;
    create(args: { data: Record<string, unknown> }): Promise<User>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<User>;
    delete(args: { where: { id: string } }): Promise<User>;
  }
  class PrismaClient {
    user: UserDelegate;
    $connect(): Promise<void>;
    $disconnect(): Promise<void>;
  }
  export { PrismaClient, User };
}

declare module 'csv-parser' {
  const csvParser: unknown;
  export default csvParser;
}

declare module '@sample/shared-utils' {
  export const logger: {
    info(message: string): void;
    error(message: string): void;
    warn(message: string): void;
    debug(message: string): void;
  };
  export function formatUser(user: { id: string; name: string; email: string; createdAt: string }): {
    id: string;
    name: string;
    email: string;
    displayName: string;
    createdAt: string;
  };
  export function validateEmail(email: string): boolean;
}
