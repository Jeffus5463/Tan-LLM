import { randomUUID } from "node:crypto";
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";

type IntegrityCheckRow = {
  integrity_check: string;
};

function assertHealthyDatabase(filename: string): void {
  const database = new Database(filename, {
    fileMustExist: true,
    readonly: true,
  });

  try {
    const rows = database.pragma("integrity_check") as IntegrityCheckRow[];

    if (rows.length !== 1 || rows[0]?.integrity_check !== "ok") {
      throw new Error(`SQLite integrity check failed for ${filename}.`);
    }
  } finally {
    database.close();
  }
}

export async function backupDatabase(
  databaseFilename: string,
  backupFilename: string,
): Promise<void> {
  const source = resolve(databaseFilename);
  const destination = resolve(backupFilename);

  if (source === destination) {
    throw new Error("The backup path must differ from the database path.");
  }

  if (existsSync(destination)) {
    throw new Error(`The backup already exists: ${destination}`);
  }

  mkdirSync(dirname(destination), { recursive: true });
  const database = new Database(source, {
    fileMustExist: true,
    readonly: true,
  });

  try {
    await database.backup(destination);
    assertHealthyDatabase(destination);
  } catch (error) {
    rmSync(destination, { force: true });
    throw error;
  } finally {
    database.close();
  }
}

export function restoreDatabase(
  backupFilename: string,
  databaseFilename: string,
): void {
  const source = resolve(backupFilename);
  const destination = resolve(databaseFilename);

  if (source === destination) {
    throw new Error("The backup path must differ from the database path.");
  }

  assertHealthyDatabase(source);
  mkdirSync(dirname(destination), { recursive: true });

  const identifier = `${process.pid}-${randomUUID()}`;
  const staged = `${destination}.restore-${identifier}`;
  const previous = `${destination}.previous-${identifier}`;
  let previousDatabaseMoved = false;
  let restoredDatabaseInstalled = false;

  try {
    copyFileSync(source, staged, constants.COPYFILE_EXCL);
    assertHealthyDatabase(staged);

    if (existsSync(destination)) {
      renameSync(destination, previous);
      previousDatabaseMoved = true;
    }

    rmSync(`${destination}-wal`, { force: true });
    rmSync(`${destination}-shm`, { force: true });
    rmSync(`${destination}-journal`, { force: true });
    renameSync(staged, destination);
    restoredDatabaseInstalled = true;
    assertHealthyDatabase(destination);
    rmSync(previous, { force: true });
    previousDatabaseMoved = false;
  } catch (error) {
    if (restoredDatabaseInstalled) {
      rmSync(destination, { force: true });
    }

    if (previousDatabaseMoved && !existsSync(destination)) {
      renameSync(previous, destination);
    }

    throw error;
  } finally {
    rmSync(staged, { force: true });
  }
}
