import Database from "better-sqlite3";

const DATABASE_BUSY_TIMEOUT_MS = 5_000;

export function openDatabase(filename: string): Database.Database {
  const database = new Database(filename, {
    timeout: DATABASE_BUSY_TIMEOUT_MS,
  });

  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");

  return database;
}
