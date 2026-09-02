import { buildApp } from "./app.js";
import { loadAuthConfig } from "./auth/config.js";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.PORT ?? "3001", 10);

const authConfig = await loadAuthConfig(process.env);
const app = buildApp({ authConfig });

try {
  await app.listen({
    host,
    port,
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
