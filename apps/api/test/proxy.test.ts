import { describe, expect, it } from "vitest";

import { loadProxyTrust } from "../src/proxy.js";

function configuredProxyTrust(addresses: string) {
  const trust = loadProxyTrust({ TRUSTED_PROXY_IPS: addresses });

  if (trust === false) {
    throw new Error("Expected proxy trust to be configured.");
  }

  return trust;
}

describe("loadProxyTrust", () => {
  it.each([undefined, "", "   "])(
    "disables proxy trust when no addresses are configured: %j",
    (addresses) => {
      expect(loadProxyTrust({ TRUSTED_PROXY_IPS: addresses })).toBe(false);
    },
  );

  it("trusts only configured addresses at the immediate proxy hop", () => {
    const trust = configuredProxyTrust("172.20.0.2, 172.20.0.3");

    expect(trust("172.20.0.2", 0)).toBe(true);
    expect(trust("172.20.0.3", 0)).toBe(true);
    expect(trust("172.20.0.4", 0)).toBe(false);
    expect(trust("172.20.0.2", 1)).toBe(false);
    expect(trust("172.20.0.2", 2)).toBe(false);
    expect(trust("not-an-address", 0)).toBe(false);
  });

  it("recognizes IPv4-mapped IPv6 socket addresses", () => {
    const trust = configuredProxyTrust("172.20.0.2");

    expect(trust("::ffff:172.20.0.2", 0)).toBe(true);
    expect(trust("::ffff:ac14:2", 0)).toBe(true);
    expect(trust("::ffff:172.20.0.3", 0)).toBe(false);
  });

  it("recognizes equivalent IPv6 address notation", () => {
    const trust = configuredProxyTrust("fd00::2");

    expect(trust("fd00:0:0:0:0:0:0:2", 0)).toBe(true);
    expect(trust("fd00::3", 0)).toBe(false);
  });

  it.each([
    "true",
    "*",
    "172.20.0.0/16",
    "web",
    "999.1.1.1",
    "172.20.0.2,",
    ",172.20.0.2",
  ])("rejects an invalid proxy address list: %j", (addresses) => {
    expect(() => loadProxyTrust({ TRUSTED_PROXY_IPS: addresses })).toThrow(
      "TRUSTED_PROXY_IPS must contain only comma-separated IP addresses.",
    );
  });
});
