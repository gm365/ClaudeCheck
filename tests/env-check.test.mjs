import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { AI_TARGETS } from "../src/lib/ai-targets.js";
import {
  CLAUDE_TARGETS,
  buildEnvCheckAiPrompt,
  envCheckAskPlan,
  evaluateCheck,
  isPrivateIp,
  maskIp,
  maskIpsInText,
  matchDatacenterByOrgOrAsn,
  parseCloudflareTrace,
  parseEdnsGeo,
  timezoneOffsetMinutes,
} from "../src/lib/env-check.js";
import worker, { handleEnvCheck } from "../worker/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("isPrivateIp identifies private ranges and Clash/Mihomo Fake-IP", () => {
  assert.equal(isPrivateIp("192.168.1.1"), true);
  assert.equal(isPrivateIp("10.0.0.1"), true);
  assert.equal(isPrivateIp("172.16.5.2"), true);
  assert.equal(isPrivateIp("100.64.0.1"), true);
  assert.equal(isPrivateIp("198.18.0.1"), true);
  assert.equal(isPrivateIp("198.19.255.254"), true);
  assert.equal(isPrivateIp("fe80::1"), true);
  assert.equal(isPrivateIp("fc00::1"), true);
  assert.equal(isPrivateIp("1.1.1.1"), false);
  assert.equal(isPrivateIp("8.8.8.8"), false);
  assert.equal(isPrivateIp("198.20.0.1"), false);
});

test("network and local scoring weights each sum to 100 independently", () => {
  const res = evaluateCheck({
    overseas: {
      ok: true,
      source: "ipapi.is",
      ip: "203.0.113.10",
      country: "US",
      city: "Los Angeles",
      timezone: "America/Los_Angeles",
      asn: 7922,
      org: "Comcast",
      asnType: "isp",
      isDatacenter: false,
      isVpn: false,
      isProxy: false,
      isTor: false,
      isAbuser: false,
    },
    webrtc: { supported: true, blocked: false, publicIps: [], localIps: [], mdnsCount: 1, srflxCount: 0 },
    dns: {
      ok: true,
      source: "bash.ws",
      servers: [{ ip: "172.253.6.16", country: "US", countryName: "USA", asn: "AS15169 Google LLC", org: "Google LLC" }],
    },
    claude: CLAUDE_TARGETS.map((t) => ({ ...t, ok: true, rttMs: 120 })),
    local: {
      timezone: "America/Los_Angeles",
      timezoneOffset: -(timezoneOffsetMinutes("America/Los_Angeles") ?? -480),
      intlLocale: "en-US",
      languages: ["en-US", "en"],
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      brands: ["Chromium"],
      model: "",
      platform: "macOS",
      isMac: true,
      vendorFonts: [],
      commonCnFonts: ["PingFang SC", "Hiragino Sans GB", "STSong", "Songti SC"],
    },
  });

  const netSum = res.network.items.reduce((s, x) => s + x.weight, 0);
  const localSum = res.local.items.reduce((s, x) => s + x.weight, 0);
  assert.equal(netSum, 100);
  assert.equal(localSum, 100);
  assert.equal(res.network.riskScore, 0);
  assert.equal(res.local.riskScore, 0);
  assert.equal(res.network.riskLevel, "low");
  assert.equal(res.local.riskLevel, "low");
});

test("same-origin edge containing claude automatically activates claude_keyword mode", () => {
  const res = evaluateCheck({
    edge: {
      ok: true,
      source: "claude-check.example.workers.dev",
      host: "claude-check.example.workers.dev",
      isClaudeKeywordHit: true,
      ip: "154.17.2.9",
      country: "JP",
      city: "Tokyo",
      timezone: "Asia/Tokyo",
      asn: 21859,
      org: "Zenlayer Inc",
      colo: "NRT",
    },
    overseas: {
      ok: true,
      source: "ipapi.is",
      ip: "1.2.3.4",
      country: "HK",
      city: "Hong Kong",
      timezone: "Asia/Hong_Kong",
      asn: 45102,
      org: "Alibaba",
      isDatacenter: true,
    },
    claude: CLAUDE_TARGETS.map((t) => ({ ...t, ok: true, rttMs: 95 })),
    local: {
      timezone: "Asia/Shanghai",
      timezoneOffset: -480,
      intlLocale: "zh-CN",
      languages: ["zh-CN", "en"],
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      brands: [],
      model: "",
      platform: "macOS",
      isMac: true,
      vendorFonts: [],
      commonCnFonts: ["PingFang SC"],
    },
  });

  assert.equal(res.exitMode, "claude_keyword");
  assert.equal(res.activeNet.ip, "154.17.2.9");
  assert.equal(res.activeNet.country, "JP");
  // Zenlayer and expanded Tier-1 / APAC / VPS / VPN ASNs detected via ASN/org fallback without false positives on residential ISPs
  assert.equal(matchDatacenterByOrgOrAsn(21859, "Zenlayer Inc"), true);
  assert.equal(matchDatacenterByOrgOrAsn(2914, "NTT America, Inc."), true);
  assert.equal(matchDatacenterByOrgOrAsn(null, "NTT America, Inc."), true);
  assert.equal(matchDatacenterByOrgOrAsn(174, "Cogent Communications"), true);
  assert.equal(matchDatacenterByOrgOrAsn(6939, "Hurricane Electric LLC"), true);
  assert.equal(matchDatacenterByOrgOrAsn(3491, "PCCW Global, Inc."), true);
  assert.equal(matchDatacenterByOrgOrAsn(7684, "SAKURA Internet Inc."), true);
  assert.equal(matchDatacenterByOrgOrAsn(7506, "GMO Internet Group, Inc."), true);
  assert.equal(matchDatacenterByOrgOrAsn(138997, "Akari Networks"), true);
  assert.equal(matchDatacenterByOrgOrAsn("AS136907", "HUAWEI CLOUDS"), true);
  assert.equal(matchDatacenterByOrgOrAsn(4713, "NTT Communications / OCN"), false);
  assert.equal(matchDatacenterByOrgOrAsn(9605, "NTT DOCOMO, INC."), false);
  assert.equal(matchDatacenterByOrgOrAsn(4760, "PCCW Limited"), false);
  assert.equal(matchDatacenterByOrgOrAsn(1221, "Telstra Limited"), false);
  assert.equal(matchDatacenterByOrgOrAsn(7922, "Comcast Cable Communications"), false);
  assert.equal(matchDatacenterByOrgOrAsn(11232, "Midcontinent Communications (MIDCO)"), false);
  const ipPurity = res.network.items.find((x) => x.id === "ip_purity");
  assert.equal(ipPurity.score, 18);
  assert.equal(ipPurity.status, "warn");
  // Asia/Shanghai is in CN_TIMEZONES -> err (+28) and reports 1h diff with Asia/Tokyo
  const tzItem = res.local.items.find((x) => x.id === "system_timezone");
  assert.equal(tzItem.status, "err");
  assert.equal(tzItem.score, 28);
  assert.match(tzItem.detail, /1 小时/);
});

test("parseCloudflareTrace extracts ip, loc, colo and host", () => {
  const parsed = parseCloudflareTrace("fl=123\nh=claude.ai\nip=198.51.100.7\nloc=US\ncolo=SJC\n");
  assert.ok(parsed);
  assert.equal(parsed.ip, "198.51.100.7");
  assert.equal(parsed.country, "US");
  assert.equal(parsed.colo, "SJC");
  assert.equal(parsed.host, "claude.ai");
  assert.equal(parseCloudflareTrace("invalid text"), null);
});

test("DNS leak detection parses edns geo and scores restricted DNS resolvers", () => {
  assert.deepEqual(parseEdnsGeo("China - CHINANET Yunnan province IDC1 network"), {
    country: "CN",
    countryName: "China",
    org: "CHINANET Yunnan province IDC1 network",
  });
  const res = evaluateCheck({
    overseas: { ok: true, source: "ipapi.is", ip: "203.0.113.10", country: "US", timezone: "America/Los_Angeles", isDatacenter: false },
    dns: {
      ok: true,
      source: "edns.ip-api.com",
      servers: [{ ip: "182.242.140.60", country: "CN", countryName: "China", asn: "", org: "CHINANET" }],
    },
  });
  const dnsItem = res.network.items.find((x) => x.id === "dns_leak");
  assert.equal(dnsItem.score, 14);
  assert.equal(dnsItem.status, "err");
  assert.ok(res.fixes.some((f) => f.title.includes("DNS")));
});

test("maskIp and maskIpsInText redact IPv4/IPv6 suffixes for share cards and ?mask=1", () => {
  assert.equal(maskIp("192.220.8.216"), "192.220.*.*");
  assert.equal(maskIp("2a10:e184:9c9b:1206::1"), "2a10:e184:*:*");
  assert.equal(
    maskIpsInText("Exit 192.220.8.216 / DNS 182.242.140.60"),
    "Exit 192.220.*.* / DNS 182.242.*.*",
  );
});

test("buildEnvCheckAiPrompt and envCheckAskPlan format summary cleanly", () => {
  const res = evaluateCheck({
    overseas: {
      ok: true,
      source: "ipapi.is",
      ip: "203.0.113.5",
      country: "HK",
      org: "Example IDC",
      isDatacenter: true,
    },
    claude: CLAUDE_TARGETS.map((t) => ({ ...t, ok: true, rttMs: 140 })),
  });
  const prompt = buildEnvCheckAiPrompt(res, { url: "https://claude-check.example.workers.dev/" });
  assert.match(prompt, /网络与代理风险：/);
  assert.match(prompt, /本地指纹风险：/);
  assert.match(prompt, /HK/);

  const gpt = AI_TARGETS.find((t) => t.id === "chatgpt");
  const plan = envCheckAskPlan(gpt, res, { url: "https://claude-check.example.workers.dev/" });
  assert.equal(plan.filled, true);
  assert.ok(plan.url.startsWith("https://chatgpt.com/?q="));
});

test("Cloudflare Worker /api/env-check returns no-store JSON and respects CORS/method", async () => {
  const req = new Request("https://claude-check.example.workers.dev/api/env-check", {
    headers: {
      Origin: "https://check.example.com",
      "CF-Connecting-IP": "198.51.100.42",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  Object.defineProperty(req, "cf", {
    value: {
      country: "US",
      city: "San Jose",
      region: "California",
      timezone: "America/Los_Angeles",
      asn: 13335,
      asOrganization: "Cloudflare, Inc.",
      colo: "SJC",
      httpProtocol: "HTTP/2",
      tlsVersion: "TLSv1.3",
    },
  });

  const res = handleEnvCheck(req, { ALLOWED_ORIGIN: "*" });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Cache-Control") || "", /no-store/);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  const body = await res.json();
  assert.equal(body.ip, "198.51.100.42");
  assert.equal(body.country, "US");
  assert.equal(body.host, "claude-check.example.workers.dev");
  assert.equal(body.asn, 13335);

  const postRes = await worker.fetch(
    new Request("https://claude-check.example.workers.dev/api/env-check", { method: "POST" }),
    {},
  );
  assert.equal(postRes.status, 405);
});

test("EnvCheck.svelte enforces UI & UX guardrails", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/lib/EnvCheck.svelte"), "utf8");
  assert.equal(/border-left\s*:/.test(src), false, "Should not use colored left vertical bars");
  assert.equal(/onMount\(\(\) => \{\s*[\s\S]{0,120}runScan\(/.test(src), false, "Should require manual click to scan");
  assert.equal(/不保证通过|仅供参考/.test(src), false, "Should avoid over-defensive boilerplate");
});

test("open-source repository contains zero private or internal domain leaks", () => {
  const forbidden = [/shuita/i, /tgaicrawl/i, /upsui/i, /水獭/, /codertesla/i, /lisahost/i, /49013475/];
  const ignoreDirs = new Set(["node_modules", "dist", ".git", ".wrangler"]);

  function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignoreDirs.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else out.push(full);
    }
    return out;
  }

  for (const file of walk(ROOT)) {
    // Skip this test file itself since it contains the regex patterns above
    if (file === fileURLToPath(import.meta.url)) continue;
    if (path.basename(file) === "package-lock.json") continue;
    const text = fs.readFileSync(file, "utf8");
    for (const re of forbidden) {
      assert.equal(re.test(text), false, `Found forbidden pattern ${re} in ${path.relative(ROOT, file)}`);
    }
  }
});
