/**
 * Layer detection patterns for TypeScript/JavaScript projects
 * Converted from SpecMind's data-layer.json, api-layer.json, external-layer.json
 * Keeping only TS/JS relevant patterns
 */

// ---------------------------------------------------------------------------
// Data Layer Patterns
// ---------------------------------------------------------------------------

export const dataLayerPatterns = {
  orms: [
    'prisma',
    '@prisma/client',
    'typeorm',
    'mikro-orm',
    '@mikro-orm/core',
    'sequelize',
    'sequelize-typescript',
    'mongoose',
    'typegoose',
    '@typegoose/typegoose',
    'knex',
    'objection',
    'drizzle-orm',
    'kysely',
    'bookshelf',
    'waterline',
    // Python
    'sqlalchemy',
    'django.db',
    'tortoise',
    'peewee',
    'mongoengine',
    'sqlmodel',
  ],

  drivers: {
    postgresql: ['pg', 'pg-promise', 'postgres', 'psycopg2', 'asyncpg', 'psycopg'],
    mysql: ['mysql', 'mysql2', 'pymysql'],
    sqlite: ['better-sqlite3', 'sqlite', 'sqlite3'],
    redis: ['redis', 'ioredis', '@redis/client', 'aioredis'],
    mongodb: ['mongodb', 'pymongo', 'motor'],
    cassandra: ['cassandra-driver'],
    elasticsearch: ['@elastic/elasticsearch'],
    neo4j: ['neo4j-driver'],
    sqlserver: ['mssql', 'tedious'],
  } as Record<string, string[]>,

  queryBuilders: [
    'knex',
    'kysely',
    '@databases/pg',
    '@databases/mysql',
    'slonik',
  ],

  filePatterns: [
    '**/*model*.{ts,js}',
    '**/*schema*.{ts,js}',
    '**/*entity*.{ts,js}',
    '**/*repository*.{ts,js}',
    '**/models/**',
    '**/schemas/**',
    '**/entities/**',
    '**/repositories/**',
    '**/migrations/**',
    '**/db/**',
    '**/database/**',
    '**/persistence/**',
  ],
}

// ---------------------------------------------------------------------------
// API Layer Patterns
// ---------------------------------------------------------------------------

export const apiLayerPatterns = {
  frameworks: [
    'express',
    '@nestjs/common',
    '@nestjs/core',
    'fastify',
    '@fastify/cors',
    'koa',
    '@koa/router',
    'hapi',
    '@hapi/hapi',
    'restify',
    'polka',
    'micro',
    'next',
    'next/server',
    'remix',
    '@trpc/server',
    'elysia',
    'hono',
    // Python
    'flask',
    'fastapi',
    'django.http',
    'django.urls',
    'starlette',
    'sanic',
    'falcon',
    'pyramid',
  ],

  graphql: [
    'graphql',
    'apollo-server',
    '@apollo/server',
    'apollo-server-express',
    'express-graphql',
    'graphql-yoga',
    'type-graphql',
    'nexus',
    'pothos',
  ],

  decorators: [
    '@Get',
    '@Post',
    '@Put',
    '@Delete',
    '@Patch',
    '@Controller',
    '@ApiTags',
    '@ApiOperation',
    'router.get(',
    'router.post(',
    'router.put(',
    'router.delete(',
    'app.get(',
    'app.post(',
    'app.use(',
    '.query(',
    '.mutation(',
    'app.route(',
  ],

  filePatterns: [
    '**/routes/**',
    '**/routers/**',
    '**/controllers/**',
    '**/handlers/**',
    '**/api/**',
    '**/endpoints/**',
    '**/views/**',
    '**/*route*.{ts,js}',
    '**/*router*.{ts,js}',
    '**/*controller*.{ts,js}',
    '**/*handler*.{ts,js}',
    '**/*endpoint*.{ts,js}',
    '**/*view*.{ts,js}',
    '**/app/api/**',
    '**/pages/api/**',
    '*.graphql',
    '*.gql',
  ],

  rpcPatterns: [
    'grpc',
    '@grpc/grpc-js',
    'grpc-tools',
    '@trpc/server',
    'json-rpc',
    '*.proto',
  ],
}

// ---------------------------------------------------------------------------
// External Layer Patterns
// ---------------------------------------------------------------------------

export const externalLayerPatterns = {
  httpClients: [
    'axios',
    'fetch',
    'node-fetch',
    'undici',
    'got',
    'superagent',
    'request',
    'needle',
    'bent',
    'ky',
    'wretch',
    // Python
    'requests',
    'httpx',
    'aiohttp',
    'urllib3',
  ],

  cloudServices: {
    aws: ['@aws-sdk/*', 'aws-sdk', 'boto3', 'botocore'],
    gcp: ['@google-cloud/*', 'google-cloud-*'],
    azure: ['@azure/*', 'azure-*'],
  } as Record<string, string[]>,

  paymentServices: {
    stripe: ['stripe', '@stripe/stripe-js'],
    paypal: ['paypal-rest-sdk', '@paypal/checkout-server-sdk'],
    square: ['square'],
    braintree: ['braintree'],
    adyen: ['adyen'],
  } as Record<string, string[]>,

  messagingServices: {
    twilio: ['twilio', '@twilio/conversations'],
    sendgrid: ['sendgrid', '@sendgrid/mail'],
    mailgun: ['mailgun-js'],
    postmark: ['postmark'],
    slack: ['@slack/web-api', '@slack/bolt'],
    discord: ['discord.js'],
    telegram: ['telegraf'],
    whatsapp: ['whatsapp-web.js'],
  } as Record<string, string[]>,

  aiServices: {
    openai: ['openai'],
    anthropic: ['@anthropic-ai/sdk', 'anthropic'],
    cohere: ['cohere-ai'],
    'google-ai': ['@google-ai/generativelanguage'],
    replicate: ['replicate'],
    huggingface: ['huggingface', '@huggingface/inference'],
  } as Record<string, string[]>,

  authServices: {
    auth0: ['auth0', '@auth0/auth0-react'],
    passport: ['passport', 'passport-*'],
    firebase: ['firebase-admin', 'firebase/auth'],
    supabase: ['@supabase/supabase-js'],
    clerk: ['@clerk/nextjs'],
    'next-auth': ['next-auth'],
    okta: ['@okta/okta-auth-js'],
  } as Record<string, string[]>,

  messageQueues: {
    rabbitmq: {
      packages: ['amqplib', 'amqp'],
      type: 'message-queue',
    },
    kafka: {
      packages: ['kafkajs', 'node-rdkafka'],
      type: 'event-stream',
    },
    'redis-queue': {
      packages: ['bull', 'bee-queue', 'bullmq', 'kue'],
      type: 'task-queue',
    },
    'aws-sqs': {
      packages: ['@aws-sdk/client-sqs'],
      type: 'message-queue',
    },
    'aws-sns': {
      packages: ['@aws-sdk/client-sns'],
      type: 'pub-sub',
    },
    'aws-eventbridge': {
      packages: ['@aws-sdk/client-eventbridge'],
      type: 'event-bus',
    },
    'gcp-pubsub': {
      packages: ['@google-cloud/pubsub'],
      type: 'pub-sub',
    },
    'azure-servicebus': {
      packages: ['@azure/service-bus'],
      type: 'message-queue',
    },
    nats: {
      packages: ['nats'],
      type: 'message-queue',
    },
  } as Record<string, { packages: string[]; type: string }>,

  filePatterns: [
    '**/integrations/**',
    '**/external/**',
    '**/clients/**',
    '**/services/external/**',
    '**/third-party/**',
    '**/*client*.{ts,js}',
    '**/*integration*.{ts,js}',
    '**/*sdk*.{ts,js}',
  ],
}
