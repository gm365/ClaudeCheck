/**
 * ClaudeCheck Cloudflare Worker 入口
 *
 * 仅处理 /api/env-check：读取 Cloudflare 请求元信息（request.cf）与 Accept-Language，
 * 零数据库、零日志存储、强制 no-store；其余静态页面交由 Static Assets 直接响应。
 *
 * 可选环境变量：
 *   ALLOWED_ORIGIN — 若将检测接口部署在独立含 claude 关键词的子域，
 *                    可配置主站 Origin（如 https://check.example.com）允许跨域读取。
 */

export const ENV_CHECK_PATH = "/api/env-check";

function corsHeaders(request, env) {
  const origin = request.headers.get("origin") || "";
  if (!origin) return {};
  const allowed = String(env?.ALLOWED_ORIGIN || "").trim();
  const isLocal = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(origin);
  if (isLocal || (allowed && (allowed === "*" || allowed.split(",").map((s) => s.trim()).includes(origin)))) {
    return {
      "access-control-allow-origin": allowed === "*" ? "*" : origin,
      "access-control-allow-methods": "GET, HEAD, OPTIONS",
      vary: "Origin",
    };
  }
  return {};
}

export function handleEnvCheck(request, env = {}) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, max-age=0",
    "x-robots-tag": "noindex",
    ...corsHeaders(request, env),
  };

  const method = request.method.toUpperCase();
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...headers, allow: "GET, HEAD, OPTIONS" } });
  }
  if (method !== "GET" && method !== "HEAD") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...headers, allow: "GET, HEAD, OPTIONS" },
    });
  }

  const url = new URL(request.url);
  const cf = request.cf || {};
  const payload = {
    host: url.hostname,
    ip: request.headers.get("cf-connecting-ip") || "",
    country: cf.country || request.headers.get("cf-ipcountry") || "",
    region: cf.region || "",
    city: cf.city || "",
    timezone: cf.timezone || "",
    asn: typeof cf.asn === "number" ? cf.asn : null,
    asOrganization: cf.asOrganization || "",
    colo: cf.colo || "",
    httpProtocol: cf.httpProtocol || "",
    tlsVersion: cf.tlsVersion || "",
    acceptLanguage: request.headers.get("accept-language") || "",
    checkedAt: new Date().toISOString(),
  };

  return new Response(method === "HEAD" ? null : JSON.stringify(payload), {
    status: 200,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === ENV_CHECK_PATH) {
      return handleEnvCheck(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
