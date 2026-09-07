import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  backupDatabase,
  restoreDatabase,
} from "../src/database/maintenance.js";

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "tan-llm-maintenance-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createFixtureDatabase(filename: string, values: string[]): void {
  const database = new Database(filename);

  try {
    database.exec("CREATE TABLE entries (value TEXT NOT NULL) STRICT;");
    const insert = database.prepare("INSERT INTO entries (value) VALUES (?)");

    for (const value of values) {
      insert.run(value);
    }
  } finally {
    database.close();
  }
}

function readFixtureValues(filename: string): string[] {
  const database = new Database(filename, {
    fileMustExist: true,
    readonly: true,
  });

  try {
    return database
      .prepare("SELECT value FROM entries ORDER BY rowid")
      .pluck()
      .all() as string[];
  } finally {
    database.close();
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("database maintenance", () => {
  it("creates a consistent backup without changing the source", async () => {
    const directory = createTemporaryDirectory();
    const source = join(directory, "source.db");
    const backup = join(directory, "backups", "snapshot.db");
    createFixtureDatabase(source, ["first", "second"]);

    await backupDatabase(source, backup);

    expect(existsSync(backup)).toBe(true);
    expect(readFixtureValues(backup)).toEqual(["first", "second"]);
    expect(readFixtureValues(source)).toEqual(["first", "second"]);
  });

  it("does not overwrite an existing backup", async () => {
    const directory = createTemporaryDirectory();
    const source = join(directory, "source.db");
    const backup = join(directory, "snapshot.db");
    createFixtureDatabase(source, ["source"]);
    createFixtureDatabase(backup, ["existing"]);

    await expect(backupDatabase(source, backup)).rejects.toThrow(
      "The backup already exists",
    );
    expect(readFixtureValues(backup)).toEqual(["existing"]);
  });

  it("restores a validated backup over an existing database", async () => {
    const directory = createTemporaryDirectory();
    const databasePath = join(directory, "application.db");
    const backupPath = join(directory, "snapshot.db");
    createFixtureDatabase(databasePath, ["current"]);
    createFixtureDatabase(backupPath, ["restored", "history"]);

    restoreDatabase(backupPath, databasePath);

    expect(readFixtureValues(databasePath)).toEqual(["restored", "history"]);
  });

  it("rejects an invalid backup without changing the database", () => {
    const directory = createTemporaryDirectory();
    const databasePath = join(directory, "application.db");
    const backupPath = join(directory, "invalid.db");
    createFixtureDatabase(databasePath, ["current"]);
    writeFileSync(backupPath, "not a SQLite database");

    expect(() => restoreDatabase(backupPath, databasePath)).toThrow();
    expect(readFixtureValues(databasePath)).toEqual(["current"]);
  });
});
