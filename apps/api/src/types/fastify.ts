import type Database from "better-sqlite3";

declare module "fastify" {
  interface FastifyInstance {
    database: Database.Database;
  }
}

export {};
