import type { MiddlewareHandler } from "hono";
import type { Env } from "../env";
import { verifyAccessJwt } from "../lib/access";
import { Layout } from "../views/Layout";

// Access を通さない入口。どちらも送り手の署名で検証する(Slack の署名 / 入室 Webhook の Secret)
export const WEBHOOK_PATHS = new Set(["/slack/events", "/events/entry"]);

/**
 * production では、Webhook 以外のすべて(オーナー画面)を Cloudflare Access の JWT が検証できたときだけ通す。
 * 設定(チームのドメイン・AUD)が入っていなければ、通さない側に倒す。demo では何もしない。
 */
export const accessGuard: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  if (c.env.ENVIRONMENT !== "production") return next();
  if (WEBHOOK_PATHS.has(c.req.path)) return next();

  const token = c.req.header("Cf-Access-Jwt-Assertion");
  const teamDomain = c.env.ACCESS_TEAM_DOMAIN;
  const aud = c.env.ACCESS_AUD;
  if (token && teamDomain && aud && (await verifyAccessJwt(token, { teamDomain, aud }))) return next();

  return c.html(
    <Layout title="このページは開けません">
      <h1>このページは開けません</h1>
      <p>このページはオーナー専用です。Cloudflare Access でログインしてから開いてください。</p>
    </Layout>,
    403,
  );
};
