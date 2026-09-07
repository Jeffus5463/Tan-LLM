import { resolve } from "node:path";

import { backupDatabase, restoreDatabase } from "./maintenance.js";

const [operation, suppliedPath, unexpectedArgument] = process.argv.slice(2);
const databasePath = process.env.DATABASE_PATH?.trim();

if (!databasePath) {
  throw new Error("DATABASE_PATH is required.");
}

if (!suppliedPath || unexpectedArgument) {
  throw new Error(
    "Usage: maintenance-cli.js <backup|restore> <absolute-backup-path>",
  );
}

const backupPath = resolve(suppliedPath);

switch (operation) {
  case "backup":
    await backupDatabase(databasePath, backupPath);
    console.log(`Database backup created: ${backupPath}`);
    break;
  case "restore":
    restoreDatabase(backupPath, databasePath);
    console.log(`Database restored from: ${backupPath}`);
    break;
  default:
    throw new Error(`Unknown maintenance operation: ${operation ?? ""}`);
}
