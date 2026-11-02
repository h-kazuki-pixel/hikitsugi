// Cloudflare Access の JWT(Cf-Access-Jwt-Assertion ヘッダー)を検証する。
//
// production のオーナー画面は Access の背後に置く(設計書 7章)。Access の設定漏れや、
// workers.dev の URL を直接叩かれた場合に備えて、Worker の側でも署名・発行者・AUD・有効期限を確かめる。
// 公開鍵は https://<チーム>.cloudflareaccess.com/cdn-cgi/access/certs から取得し、しばらく持っておく。

export type AccessConfig = { teamDomain: string; aud: string };

type Jwk = JsonWebKey & { kid?: string };
type JwtHeader = { alg?: string; kid?: string };
type JwtClaims = { iss?: string; aud?: string | string[]; exp?: number; nbf?: number; email?: string; sub?: string };

const JWKS_TTL_MS = 10 * 60 * 1000;
const LEEWAY_SEC = 60;
const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();

export function clearJwksCache() {
  jwksCache.clear();
}

/** "team.cloudflareaccess.com" / "https://team.cloudflareaccess.com/" のどちらでも受け、発行者の URL にする */
export function issuerOf(teamDomain: string): string {
  const host = teamDomain.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${host}`;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part))) as T;
}

async function getKeys(issuer: string, force: boolean): Promise<Jwk[]> {
  const cached = jwksCache.get(issuer);
  if (!force && cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;
  const res = await fetch(`${issuer}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access の公開鍵を取得できません: ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = body.keys ?? [];
  jwksCache.set(issuer, { keys, fetchedAt: Date.now() });
  return keys;
}

/** 検証できたらクレームを返す。できなければ null(理由は返さない。403 にするだけなので) */
export async function verifyAccessJwt(
  token: string,
  config: AccessConfig,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<JwtClaims | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [h, p, s] = parts as [string, string, string];
    const header = decodeJson<JwtHeader>(h);
    if (header.alg !== "RS256" || !header.kid) return null;

    const issuer = issuerOf(config.teamDomain);
    let jwk = (await getKeys(issuer, false)).find((k) => k.kid === header.kid);
    if (!jwk) jwk = (await getKeys(issuer, true)).find((k) => k.kid === header.kid); // 鍵の入れ替えに追従
    if (!jwk) return null;

    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return null;

    const claims = decodeJson<JwtClaims>(p);
    if (claims.iss !== issuer) return null;
    const auds = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
    if (!auds.includes(config.aud)) return null;
    if (typeof claims.exp !== "number" || claims.exp + LEEWAY_SEC < nowSec) return null;
    if (typeof claims.nbf === "number" && claims.nbf - LEEWAY_SEC > nowSec) return null;
    return claims;
  } catch {
    return null;
  }
}
