import { buildApp } from "./app.js";
import { loadAuthConfig } from "./auth/config.js";
import { loadProxyTrust } from "./proxy.js";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.PORT ?? "3001", 10);

const authConfig = await loadAuthConfig(process.env);
const trustProxy = loadProxyTrust(process.env);
const app = buildApp({ authConfig, trustProxy });

try {
  await app.listen({
    host,
    port,
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
