import { randomBytes } from "node:crypto";

import { hashPassword } from "../apps/api/dist/auth/password.js";

const password = process.env.TAN_LLM_SETUP_PASSWORD;

if (!password) {
  throw new Error("TAN_LLM_SETUP_PASSWORD is required.");
}

const passwordHash = await hashPassword(password);

console.log(`AUTH_PASSWORD_HASH='${passwordHash}'`);
console.log(`SESSION_SECRET=${randomBytes(32).toString("hex")}`);
