import { beforeAll, describe, expect, it, onTestFinished } from "vitest";

import { buildApp } from "../src/app.js";
import { loadAuthConfig, type AuthConfig } from "../src/auth/config.js";
import { hashPassword } from "../src/auth/password.js";
import { initializeDatabase } from "../src/database/initialize.js";
import { loadProxyTrust, type ProxyTrust } from "../src/proxy.js";

let authConfig: AuthConfig;

beforeAll(async () => {
  authConfig = await loadAuthConfig({
    NODE_ENV: "production",
    AUTH_USERNAME: "household",
    AUTH_PASSWORD_HASH: await hashPassword("test-household-password"),
    SESSION_SECRET: "ab".repeat(32),
    COOKIE_SECURE: "false",
    ALLOW_LAN_HTTP: "true",
  });
});

function buildTestApp(trustProxy: false | ProxyTrust = false) {
  const app = buildApp({
    authConfig,
    trustProxy,
    database: initializeDatabase(":memory:"),
  });
  app.log.level = "silent";

  onTestFinished(async () => {
    await app.close();
  });

  return app;
}

describe("household HTTP sessions", () => {
  it("keeps separate browser sessions for the shared account", async () => {
    const app = buildTestApp();
    const cookies: string[] = [];

    for (const address of ["192.168.1.20", "192.168.1.21"]) {
      const response = await app.inject({
        method: "POST",
        url: "http://192.168.1.10:3000/api/auth/login",
        remoteAddress: address,
        payload: {
          username: "household",
          password: "test-household-password",
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");

      const cookie = response.cookies.find(
        (cookie) => cookie.name === "tan_llm_session",
      );

      if (!cookie) {
        throw new Error("Session cookie is missing.");
      }

      expect(cookie).toMatchObject({
        httpOnly: true,
        sameSite: "Strict",
        path: "/",
        maxAge: 86400,
      });
      expect(cookie.secure).not.toBe(true);
      cookies.push(cookie.value);

      const session = await app.inject({
        method: "GET",
        url: "/api/auth/session",
        cookies: { tan_llm_session: cookie.value },
      });

      expect(session.statusCode).toBe(200);
      expect(session.json()).toEqual({ username: "household" });
    }

    const [firstCookie, secondCookie] = cookies;

    if (!firstCookie || !secondCookie) {
      throw new Error("Both browser sessions are required.");
    }

    expect(firstCookie).not.toBe(secondCookie);

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      cookies: { tan_llm_session: firstCookie },
    });

    expect(logout.statusCode).toBe(204);
    expect(logout.cookies[0]).toMatchObject({ maxAge: 0 });

    const loggedOutBrowser = await app.inject({
      method: "GET",
      url: "/api/auth/session",
    });
    const otherBrowser = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      cookies: { tan_llm_session: secondCookie },
    });

    expect(loggedOutBrowser.statusCode).toBe(401);
    expect(otherBrowser.statusCode).toBe(200);
    expect(otherBrowser.json()).toEqual({ username: "household" });
  });
});

describe("household login rate limits", () => {
  it("keeps separate limits for clients behind the configured proxy", async () => {
    const app = buildTestApp(
      loadProxyTrust({ TRUSTED_PROXY_IPS: "172.20.0.2" }),
    );

    async function attempt(clientAddress: string) {
      return app.inject({
        method: "POST",
        url: "/api/auth/login",
        remoteAddress: "172.20.0.2",
        headers: { "x-forwarded-for": clientAddress },
        payload: { username: "household", password: "incorrect-password" },
      });
    }

    for (let index = 0; index < 5; index += 1) {
      expect((await attempt("192.168.1.20")).statusCode).toBe(401);
    }

    const limited = await attempt("192.168.1.20");
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    expect((await attempt("192.168.1.21")).statusCode).toBe(401);
  });

  it.each([
    { name: "disabled proxy trust", proxyIps: "", peer: "192.168.1.20" },
    {
      name: "an untrusted direct client",
      proxyIps: "172.20.0.2",
      peer: "192.168.1.20",
    },
    {
      name: "a forged chain before the immediate proxy",
      proxyIps: "172.20.0.2",
      peer: "172.20.0.2",
    },
  ])("does not bypass the limit with $name", async ({ proxyIps, peer }) => {
    const app = buildTestApp(loadProxyTrust({ TRUSTED_PROXY_IPS: proxyIps }));

    for (let index = 0; index < 6; index += 1) {
      const forgedAddress = `198.51.100.${index + 1}`;
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        remoteAddress: peer,
        headers: {
          "x-forwarded-for":
            peer === "172.20.0.2"
              ? `${forgedAddress}, 192.168.1.20`
              : forgedAddress,
        },
        payload: { username: "household", password: "incorrect-password" },
      });

      expect(response.statusCode).toBe(index < 5 ? 401 : 429);
    }
  });
});
