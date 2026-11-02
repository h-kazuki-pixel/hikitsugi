// production のオーナー画面を Cloudflare Access の JWT で守る
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { app } from "../src/index";
import { clearJwksCache, issuerOf } from "../src/lib/access";
import { demoEnv } from "./helpers";

const TEAM = "sample-team.cloudflareaccess.com";
const AUD = "test-aud-0123456789";
const KID = "test-kid-1";

let proxy: Awaited<ReturnType<typeof demoEnv>>;
let privateKey: CryptoKey;
let publicJwk: JsonWebKey;
let otherPrivateKey: CryptoKey;

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

async function sign(claims: Record<string, unknown>, key = privateKey, kid = KID) {
  const head = enc({ alg: "RS256", kid, typ: "JWT" });
  const body = enc(claims);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

const now = () => Math.floor(Date.now() / 1000);
const goodClaims = () => ({ iss: `https://${TEAM}`, aud: [AUD], exp: now() + 600, iat: now(), sub: "owner" });

const genKey = () =>
  crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  ) as Promise<CryptoKeyPair>;

beforeAll(async () => {
  proxy = await demoEnv();
  const pair = await genKey();
  privateKey = pair.privateKey;
  publicJwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: KID } as unknown as JsonWebKey;
  otherPrivateKey = (await genKey()).privateKey;
});
afterAll(async () => {
  await proxy?.dispose();
});
afterEach(() => {
  vi.unstubAllGlobals();
  clearJwksCache();
});

function stubCerts() {
  const f = vi.fn(async (url: string | URL | Request) => {
    expect(String(url)).toBe(`https://${TEAM}/cdn-cgi/access/certs`);
    return new Response(JSON.stringify({ keys: [publicJwk] }), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", f);
  return f;
}

const prodEnv = (over: Record<string, unknown> = {}) => ({
  ...proxy.env,
  ENVIRONMENT: "production",
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
  ...over,
});
const get = (path: string, token: string | null, env: object, method = "GET") =>
  app.request(path, { method, headers: token ? { "Cf-Access-Jwt-Assertion": token } : {} }, env);

describe("production: Access の JWT がないとオーナー画面は 403", () => {
  it("ヘッダーがなければ 403(日本語)", async () => {
    stubCerts();
    const res = await get("/stores/tenjin", null, prodEnv());
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("オーナー専用");
  });

  it("正しい JWT なら通す(公開鍵は一度取得して使い回す)", async () => {
    const f = stubCerts();
    const token = await sign(goodClaims());
    expect((await get("/stores/tenjin", token, prodEnv())).status).toBe(200);
    expect((await get("/", token, prodEnv())).status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["AUD が違う", async () => sign({ ...goodClaims(), aud: ["other-aud"] })],
    ["発行者が違う", async () => sign({ ...goodClaims(), iss: "https://evil.cloudflareaccess.com" })],
    ["期限切れ", async () => sign({ ...goodClaims(), exp: now() - 3600 })],
    ["別の鍵で署名", async () => sign(goodClaims(), otherPrivateKey)],
    ["知らない kid", async () => sign(goodClaims(), privateKey, "unknown-kid")],
    ["形が壊れている", async () => "not.a.jwt"],
  ])("%s なら 403", async (_label, make) => {
    stubCerts();
    expect((await get("/stores/tenjin", await make(), prodEnv())).status).toBe(403);
  });

  it("チームのドメインか AUD が未設定なら、正しい JWT でも 403(通さない側に倒す)", async () => {
    stubCerts();
    const token = await sign(goodClaims());
    expect((await get("/stores/tenjin", token, prodEnv({ ACCESS_AUD: undefined }))).status).toBe(403);
    expect((await get("/stores/tenjin", token, prodEnv({ ACCESS_TEAM_DOMAIN: undefined }))).status).toBe(403);
  });

  it("Slack と入室の Webhook は Access を通さない(送り手の署名で検証するため)", async () => {
    stubCerts();
    for (const path of ["/slack/events", "/events/entry"]) {
      expect((await get(path, null, prodEnv(), "POST")).status).not.toBe(403);
    }
  });
});

describe("demo: 何もしない", () => {
  it("JWT なしで開ける", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect((await get("/stores/tenjin", null, { ...proxy.env, ENVIRONMENT: "demo" })).status).toBe(200);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("issuerOf", () => {
  it("ドメインの書き方の揺れを吸収する", () => {
    expect(issuerOf(TEAM)).toBe(`https://${TEAM}`);
    expect(issuerOf(`https://${TEAM}/`)).toBe(`https://${TEAM}`);
  });
});
