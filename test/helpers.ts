import { getPlatformProxy } from "wrangler";
import type { Env } from "../src/env";

export async function demoEnv() {
  const proxy = await getPlatformProxy<Env>({
    environment: "demo",
    persist: { path: ".wrangler/test-state/v3" },
  });
  return proxy;
}
