
declare namespace NodeJS {
  interface ProcessEnv {
    DATABASE_URL: string;
    API_KEY?: string;
    PORT?: string;
    NODE_ENV: 'development' | 'production' | 'test';
  }
}
