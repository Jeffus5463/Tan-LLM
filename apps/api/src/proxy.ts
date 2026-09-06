import { BlockList, isIP } from "node:net";

export type ProxyTrust = (address: string, hop: number) => boolean;

export function loadProxyTrust(
  environment: NodeJS.ProcessEnv,
): false | ProxyTrust {
  const configuredIps = environment.TRUSTED_PROXY_IPS?.trim();

  if (!configuredIps) {
    return false;
  }

  const trustedAddresses = new BlockList();

  for (const entry of configuredIps.split(",")) {
    const address = entry.trim();
    const family = isIP(address);

    if (family === 0) {
      throw new Error(
        "TRUSTED_PROXY_IPS must contain only comma-separated IP addresses.",
      );
    }

    trustedAddresses.addAddress(address, family === 4 ? "ipv4" : "ipv6");
  }

  return (address, hop) => {
    if (hop !== 0) {
      return false;
    }

    const family = isIP(address);

    return (
      family !== 0 &&
      trustedAddresses.check(address, family === 4 ? "ipv4" : "ipv6")
    );
  };
}
