import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type Database from "better-sqlite3";

import { openDatabase } from "./database.js";
import { runMigrations } from "./migrations.js";
import { migrations } from "./schema.js";

export function initializeDatabase(filename: string): Database.Database {
  mkdirSync(dirname(filename), {
    recursive: true,
  });

  const database = openDatabase(filename);

  try {
    runMigrations(database, migrations);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
