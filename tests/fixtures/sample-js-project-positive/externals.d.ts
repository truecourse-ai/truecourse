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



/* Mode shape-f6a129bb94ab: namespace inside `declare module 'stripe'` augmentation in a .d.ts file. */
declare module 'stripe' {
  namespace Stripe {
    interface Customer {
      id: string;
      email: string;
      metadata: Record<string, string>;
    }
    interface Subscription {
      id: string;
      customer: string;
      status: 'active' | 'canceled' | 'past_due';
    }
    interface Event<T = unknown> {
      id: string;
      type: string;
      data: { object: T };
    }
  }
  class Stripe {
    constructor(apiKey: string, config?: { apiVersion: string });
    customers: {
      retrieve(id: string): Promise<Stripe.Customer>;
      create(params: { email: string }): Promise<Stripe.Customer>;
    };
    subscriptions: {
      retrieve(id: string): Promise<Stripe.Subscription>;
    };
    webhooks: {
      constructEvent(payload: string, sig: string, secret: string): Stripe.Event;
    };
  }
  export default Stripe;
  export { Stripe };
}

/* Mode shape-b803e8e0c3ce: declare global { namespace PrismaJson } with eslint-disable confirming intentional global type augmentation. */
/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace PrismaJson {
    type RecipientAuthOptions = {
      accessAuth: 'ACCOUNT' | null;
      actionAuth: 'PASSKEY' | 'TWO_FACTOR_AUTH' | null;
    };
    type DocumentAuthOptions = {
      globalAccessAuth: 'ACCOUNT' | null;
      globalActionAuth: 'PASSKEY' | 'TWO_FACTOR_AUTH' | null;
    };
    type TemplateMeta = {
      subject: string;
      message: string;
      timezone: string;
      dateFormat: string;
      redirectUrl: string;
    };
    type FieldMeta = {
      label?: string;
      placeholder?: string;
      required?: boolean;
      readOnly?: boolean;
    };
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

/* Mode shape-995c83a9ef61: declare namespace NodeJS in a .d.ts file for ProcessEnv ambient augmentation. */
declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: 'development' | 'production' | 'test';
    DATABASE_URL: string;
    NEXTAUTH_SECRET: string;
    NEXTAUTH_URL: string;
    STRIPE_API_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    NEXT_PUBLIC_WEBAPP_URL: string;
    PORT?: string;
  }
  interface Process {
    env: ProcessEnv;
  }
}

export {};



// --- positive fixtures for code-quality/deterministic/triple-slash-reference ---

// Mode shape-6132630311a4: Vite client ambient types in env declaration file
/// <reference types="vite/client" />
declare const __viteEnvMode: string;

// Mode shape-b902d5785237: local ambient type augmentation alongside stripe import
/// <reference types="./stripe.d.ts" />
declare const __stripeAmbientLoaded: boolean;

// Mode shape-918ad4fd3341: NodeJS.ProcessEnv augmentation via shared tsconfig package
/// <reference types="@documenso/tsconfig/process-env.d.ts" />
declare const __processEnvAugmented: boolean;
