/**
 * ClaudeCheck 检测引擎（双维度风险分独立架构 · 0–100 越低越安全）。
 *
 * 出口识别优先级：
 *   1. 用户手动粘贴的 claude.ai/cdn-cgi/trace（claude.ai 实测）
 *   2. 含 claude 关键词的边缘探针（默认：当部署域名本身含 claude 如 claude-check.*.workers.dev，
 *      或通过 VITE_CLAUDE_CHECK_ENDPOINT 指定独立子域时自动命中代理 DOMAIN-KEYWORD,claude 规则）
 *   3. 通用海外 IP 接口（ipapi.is → ipinfo.io → geojs.io）
 *   4. 同源 Cloudflare Worker 边缘接口（/api/env-check）
 */

export const OPTIONAL_CLAUDE_ENDPOINT =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_CLAUDE_CHECK_ENDPOINT) || "";

export const BLOCKED_COUNTRIES = new Set(["CN", "HK", "MO", "RU", "BY", "KP", "IR", "SY", "CU"]);

export const CN_TIMEZONES = new Set([
  "Asia/Shanghai",
  "Asia/Chongqing",
  "Asia/Chungking",
  "Asia/Harbin",
  "Asia/Urumqi",
  "Asia/Kashgar",
  "Asia/Hong_Kong",
  "Asia/Macau",
  "Asia/Macao",
  "PRC",
  "Hongkong",
]);

export const UTC8_SAFE_COUNTRIES = new Set(["SG", "TW", "MY", "PH", "AU", "BN", "MN"]);

export const DATACENTER_ASNS = new Set([
  // 国际与国内主流云厂商 / CDN
  16509, 14618, 8987, // AWS
  15169, 396982, // Google Cloud
  8075, 8068, // Microsoft Azure
  13335, 209242, // Cloudflare
  54113, // Fastly
  20940, 16625, 63949, // Akamai / Linode
  14061, // DigitalOcean
  20473, // Vultr / Choopa
  24940, 213230, // Hetzner
  16276, // OVH
  31898, // Oracle Cloud
  36351, // IBM Cloud / SoftLayer
  45102, 37963, 24429, // Alibaba Cloud
  132203, 45090, 132591, // Tencent Cloud
  136907, 55990, 139080, // Huawei Cloud
  138699, 396986, // ByteDance / Volcano Engine
  135377, // UCloud
  38365, 55967, // Baidu Cloud
  59019, // Kingsoft Cloud

  // Tier-1 国际骨干网 / Transit（无普通家宽，机场与 VPS 高频上游）
  2914, 4714, 9268, // NTT Global / NTT America / NTT PC（不含日本家宽 OCN 4713 与 Docomo 9605）
  174, // Cogent
  6939, // Hurricane Electric (HE.net)
  3257, // GTT Communications
  1299, // Arelion (Telia Carrier / Twelve99)
  3356, // Lumen / Level 3
  6461, // Zayo / AboveNet
  6453, // Tata Communications
  3491, // PCCW Global（不含香港 HKT 家宽 4760）
  4637, // Telstra Global（不含澳洲本土 Telstra 1221）
  9002, // RETN
  137409, // GSL Networks

  // 亚太与欧美高频 VPS / 机场落地 IDC / 托管商
  21859, 40065, // Zenlayer
  906, 54574, // DMIT
  25820, // IT7 / Bandwagon
  3214, 4842, 6233, 9312, // xTom / V.PS
  917, 57695, // Misaka Network
  138997, 141995, // Akari Networks / Nearoute
  139317, 44735, // Kirino
  136766, // RFCHOST / Jinx
  7684, 9370, // Sakura Internet（樱花机房）
  7506, // GMO Internet / ConoHa
  18077, // Kagoya Japan
  131965, // Xserver
  136800, // LayerStack
  55933, // Cloudie / Dataplugs
  9009, // M247
  212238, 60068, // DataCamp / CDN77
  60781, 28753, 16265, 60626, // LeaseWeb
  51167, 40021, // Contabo / CeraNetworks
  199524, // GCore
  147049, // Packethub
  40676, // Psychz
  46844, // Sharktech
  8100, // QuadraNet
  53667, // FranTech / BuyVM
  36352, // ColoCrossing
  35916, // Multacom
  29802, // Hivelocity
  3223, // Voxility
  50673, // Serverius
  49981, // WorldStream
  62240, // Clouvider
  12876, // Scaleway / Online S.A.S
  8560, // IONOS / 1&1
  47583, // Hostinger
  36007, // Kamatera
  202053, // UpCloud
  54825, // Equinix Metal (Packet)
  16552, 396356, // Latitude.sh (Maxihost)
  399646,

  // 商业 VPN / 代理底座专用 ASN
  136787, // Tefincom (NordVPN)
  51852, // Private Layer
  46562, // Performive / Total Server Solutions
  39351, // 31173 Services (Mullvad)
  11878, // Tzulo
  36236, // NetActuate
]);

// 主流本土家庭宽带 / 移动网络 ASN 白名单：防止母公司名称（如日本 OCN AS4713 挂在 NTT Communications 名下）被组织名正则误伤
export const RESIDENTIAL_ISP_ASNS = new Set([
  4713, // 日本 OCN (NTT Communications 本土家宽)
  9605, // 日本 NTT Docomo
  2516, // 日本 KDDI
  17676, // 日本 SoftBank
  4760, // 香港 HKT / PCCW 家宽
  9269, // 香港 HKBN
  1221, // 澳洲 Telstra 本土家宽
  3462, // 台湾 中华电信 HiNet
  4780, // 台湾 远传电信
  9924, // 台湾 台湾大哥大
  7922, // 美国 Comcast
  7018, // 美国 AT&T
  701, 22394, // 美国 Verizon
  20115, // 美国 Charter / Spectrum
]);

export const DATACENTER_ORG_RE =
  /Zenlayer|SpeedyCloud|Amazon|AWS|Google\s+(Cloud|LLC)|Microsoft|Azure|DigitalOcean|Vultr|Choopa|Linode|Akamai|Cloudflare|Fastly|Hetzner|OVH|Oracle|IBM\s+Cloud|SoftLayer|Alibaba|Aliyun|Tencent|Huawei\s+Cloud|ByteDance|Volcano\s*Engine|UCloud|Baidu|Kingsoft|NTT\s+(America|Communications|PC|Ltd|DATA|Global)|NTT-?GIN|Cogent|Hurricane\s+Electric|GTT\s+Communications|Arelion|Twelve99|Telia\s+Carrier|Zayo|AboveNet|Tata\s+Communications|PCCW\s+Global|Telstra\s+(Global|International)|GSL\s+Networks|\bRETN\b|DMIT|Bandwagon|IT7|M247|DataCamp|CDN77|LeaseWeb|Contabo|G-?Core|Packethub|Psychz|Sharktech|QuadraNet|FranTech|BuyVM|ColoCrossing|RackNerd|Misaka|xTom|V\.PS|Akari\s+Networks|Nearoute|Kirino|RFCHOST|Sakura\s+Internet|GMO\s+Internet|ConoHa|Kagoya|Xserver|LayerStack|Dataplugs|Cloudie|Multacom|Hivelocity|Voxility|Serverius|WorldStream|Clouvider|Scaleway|Online\s+S\.A\.S|IONOS|Hostinger|Kamatera|UpCloud|Equinix\s+Metal|Maxihost|Latitude\.sh|CeraNetworks|CloudCone|Spartan\s*Host|GreenCloud|VirMach|Hostodo|Hyonix|Tefincom|NordVPN|Private\s+Layer|Performive|31173\s+Services|Mullvad|NetActuate|Tzulo|Hosting|Datacenter|Data\s*Center|Cloud\s+Computing|Colocation|Dedicated\s+Server|\b(VPS|IDC)\b/i;

export const CN_VENDOR_FONTS = [
  "MiSans",
  "HarmonyOS Sans",
  "HarmonyOS Sans SC",
  "OPPO Sans",
  "vivo Sans",
  "FZLTHJW",
  "FZLanTingHeiS-R-GB",
  "Kingsoft Cloud Font",
  "Alibaba PuHuiTi",
];

export const COMMON_CN_FONTS = [
  "PingFang SC",
  "Microsoft YaHei",
  "Hiragino Sans GB",
  "SimSun",
  "SimHei",
  "STSong",
  "Songti SC",
  "Noto Sans CJK SC",
];

export const MAC_DEFAULT_CN_FONTS = new Set(["PingFang SC", "Hiragino Sans GB", "STSong", "Songti SC"]);

export const CN_BROWSER_RE =
  /MicroMessenger|QQBrowser|MQQBrowser|Quark|UCBrowser|BaiduBoxApp|baidubrowser|SogouMobileBrowser|360SE|360EE|LBBROWSER|Maxthon|MetaSr|2345Explorer|HuaweiBrowser|MiuiBrowser|HeyTapBrowser|VivoBrowser/i;

export const CN_DEVICE_RE =
  /HarmonyOS|HUAWEI|HONOR|Xiaomi|Redmi|POCO|OPPO|OnePlus|realme|vivo|iQOO|Meizu|ZTE|Nubia/i;

export const CLAUDE_TARGETS = [
  { id: "claude_web", host: "claude.ai", url: "https://claude.ai/favicon.ico", label: "Claude 官网" },
  { id: "anthropic_api", host: "api.anthropic.com", url: "https://api.anthropic.com/", label: "Anthropic API" },
  { id: "anthropic_www", host: "www.anthropic.com", url: "https://www.anthropic.com/favicon.ico", label: "Anthropic 官网" },
];

export const COUNTRY_NAMES = {
  CN: "中国大陆",
  HK: "中国香港",
  MO: "中国澳门",
  TW: "中国台湾",
  US: "美国",
  JP: "日本",
  SG: "新加坡",
  GB: "英国",
  DE: "德国",
  FR: "法国",
  NL: "荷兰",
  CA: "加拿大",
  AU: "澳大利亚",
  KR: "韩国",
  RU: "俄罗斯",
  BY: "白俄罗斯",
  IR: "伊朗",
  KP: "朝鲜",
};

export const COUNTRY_DEFAULT_TZ = {
  CN: "Asia/Shanghai",
  HK: "Asia/Hong_Kong",
  MO: "Asia/Macau",
  TW: "Asia/Taipei",
  JP: "Asia/Tokyo",
  KR: "Asia/Seoul",
  SG: "Asia/Singapore",
  GB: "Europe/London",
  DE: "Europe/Berlin",
  FR: "Europe/Paris",
  NL: "Europe/Amsterdam",
  AU: "Australia/Sydney",
  US: "America/Los_Angeles",
  CA: "America/Toronto",
};

export function countryLabel(code, fallback = "") {
  const c = String(code || "").toUpperCase();
  if (!c) return fallback || "未知";
  return COUNTRY_NAMES[c] ? `${COUNTRY_NAMES[c]} (${c})` : fallback ? `${fallback} (${c})` : c;
}

export function isPrivateIp(ip) {
  const s = String(ip || "").trim().toLowerCase();
  if (!s) return false;
  if (s.includes(":")) {
    return (
      s === "::1" ||
      s.startsWith("fc") ||
      s.startsWith("fd") ||
      s.startsWith("fe80:") ||
      s.startsWith("::ffff:10.") ||
      s.startsWith("::ffff:192.168.") ||
      s.startsWith("::ffff:127.")
    );
  }
  const parts = s.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return false;
}

export function parseCloudflareTrace(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const map = {};
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k) map[k] = v;
  }
  if (!map.ip && !map.loc) return null;
  const country = String(map.loc || "").toUpperCase();
  return {
    ok: true,
    source: map.h ? `${map.h}/cdn-cgi/trace` : "claude.ai/cdn-cgi/trace",
    host: map.h || "claude.ai",
    ip: map.ip || "",
    country,
    countryName: "",
    city: "",
    timezone: COUNTRY_DEFAULT_TZ[country] || "",
    colo: map.colo || "",
    asn: null,
    org: "",
    asnType: "",
    isDatacenter: null,
    isVpn: null,
    isProxy: null,
    isTor: null,
    isAbuser: null,
    isClaudeVerified: true,
  };
}

export function timezoneOffsetMinutes(timeZone, date = new Date()) {
  if (!timeZone) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
    }).formatToParts(date);
    const tzPart = parts.find((p) => p.type === "timeZoneName")?.value || "";
    if (tzPart === "GMT" || tzPart === "UTC") return 0;
    const m = tzPart.match(/(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?/);
    if (!m) return null;
    const sign = m[1] === "-" ? -1 : 1;
    const hours = Number(m[2]);
    const mins = m[3] ? Number(m[3]) : 0;
    return sign * (hours * 60 + mins);
  } catch {
    return null;
  }
}

export function formatUtcOffset(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return "";
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m ? `UTC${sign}${h}:${String(m).padStart(2, "0")}` : `UTC${sign}${h}`;
}

export function matchDatacenterByOrgOrAsn(asn, org) {
  const numAsn =
    typeof asn === "number"
      ? asn
      : typeof asn === "string"
        ? Number(asn.trim().replace(/^AS/i, ""))
        : NaN;
  const hasValidAsn = Number.isInteger(numAsn) && numAsn > 0;
  if (hasValidAsn && DATACENTER_ASNS.has(numAsn)) return true;
  if (hasValidAsn && RESIDENTIAL_ISP_ASNS.has(numAsn)) return false;
  if (org && DATACENTER_ORG_RE.test(org)) return true;
  return false;
}

async function fetchJsonWithTimeout(url, timeoutMs = 5500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function probeSiteEdge(timeoutMs = 5000) {
  try {
    const data = await fetchJsonWithTimeout("/api/env-check", timeoutMs);
    if (!data || typeof data !== "object" || !data.ip) return null;
    const host = String(data.host || "");
    const country = String(data.country || "").toUpperCase();
    return {
      ok: true,
      source: host || "edge",
      host,
      isClaudeKeywordHit: /claude/i.test(host),
      ip: String(data.ip || ""),
      country,
      countryName: "",
      city: String(data.city || ""),
      timezone: String(data.timezone || COUNTRY_DEFAULT_TZ[country] || ""),
      asn: data.asn ?? null,
      org: String(data.asOrganization || ""),
      asOrganization: String(data.asOrganization || ""),
      colo: String(data.colo || ""),
      httpProtocol: String(data.httpProtocol || ""),
      tlsVersion: String(data.tlsVersion || ""),
      acceptLanguage: String(data.acceptLanguage || ""),
      isDatacenter: null,
      isVpn: null,
      isProxy: null,
      isTor: null,
      isAbuser: null,
    };
  } catch {
    return null;
  }
}

export async function probeClaudeEdge(endpoint = OPTIONAL_CLAUDE_ENDPOINT, timeoutMs = 4500) {
  if (!endpoint) return null;
  try {
    const data = await fetchJsonWithTimeout(endpoint, timeoutMs);
    if (!data || typeof data !== "object" || !data.ip) return null;
    const country = String(data.country || "").toUpperCase();
    return {
      ok: true,
      source: String(data.host || endpoint),
      host: String(data.host || ""),
      isClaudeKeywordHit: true,
      ip: String(data.ip || ""),
      country,
      countryName: "",
      city: String(data.city || ""),
      timezone: String(data.timezone || COUNTRY_DEFAULT_TZ[country] || ""),
      asn: data.asn ?? null,
      org: String(data.asOrganization || ""),
      asOrganization: String(data.asOrganization || ""),
      colo: String(data.colo || ""),
      acceptLanguage: String(data.acceptLanguage || ""),
      isDatacenter: null,
      isVpn: null,
      isProxy: null,
      isTor: null,
      isAbuser: null,
    };
  } catch {
    return null;
  }
}

function parseIpApiPayload(d) {
  if (!d || !d.ip) return null;
  let asn = null;
  let org = "";
  let asnType = "";
  if (d.asn && typeof d.asn === "object") {
    asn = d.asn.asn ?? null;
    org = String(d.asn.org || "");
    asnType = String(d.asn.type || "").toLowerCase();
  } else if (typeof d.asn === "string") {
    const m = d.asn.trim().match(/^AS(\d+)\s*(.*)$/i);
    if (m) {
      asn = Number(m[1]);
      org = m[2].trim();
    }
  }
  if (!org) {
    if (d.company && typeof d.company === "object") {
      org = String(d.company.name || "");
      if (!asnType) asnType = String(d.company.type || "").toLowerCase();
    } else if (typeof d.company === "string") {
      org = d.company.trim();
    }
  }
  const country = String(d.location?.country_code || d.country_code || "").toUpperCase();
  const countryName = String(d.location?.country || d.country || "");
  return {
    ip: String(d.ip),
    country: country || GEO_NAME_TO_COUNTRY[countryName.toLowerCase()] || "",
    countryName,
    city: String(d.location?.city || d.city || ""),
    timezone: String(d.location?.timezone || d.timezone || ""),
    asn,
    org,
    asnType,
    isDatacenter: typeof d.is_datacenter === "boolean" ? d.is_datacenter : null,
    isVpn: typeof d.is_vpn === "boolean" ? d.is_vpn : null,
    isProxy: typeof d.is_proxy === "boolean" ? d.is_proxy : null,
    isTor: typeof d.is_tor === "boolean" ? d.is_tor : null,
    isAbuser: typeof d.is_abuser === "boolean" ? d.is_abuser : null,
  };
}

export async function probeOverseasIp(timeoutMs = 6000) {
  let partial = null;

  try {
    const d = await fetchJsonWithTimeout("https://api.ipapi.is/", timeoutMs);
    const parsed = parseIpApiPayload(d);
    if (parsed) {
      partial = { ok: true, source: "ipapi.is", ...parsed };
      if (parsed.country) return partial;
    }
  } catch {}

  try {
    const d = await fetchJsonWithTimeout("https://ipinfo.io/json", timeoutMs);
    if (d && d.ip) {
      const country = String(d.country || "").toUpperCase();
      const orgStr = String(d.org || "");
      const asnMatch = orgStr.match(/^AS(\d+)\s*(.*)$/i);
      const merged = {
        ok: true,
        source: partial ? "ipapi.is + ipinfo.io" : "ipinfo.io",
        ip: String(d.ip),
        country,
        countryName: partial?.countryName || "",
        city: String(d.city || partial?.city || ""),
        timezone: String(d.timezone || partial?.timezone || ""),
        asn: partial?.asn ?? (asnMatch ? Number(asnMatch[1]) : null),
        org: partial?.org || (asnMatch ? asnMatch[2].trim() : orgStr),
        asnType: partial?.asnType || "",
        isDatacenter: partial?.isDatacenter ?? null,
        isVpn: partial?.isVpn ?? null,
        isProxy: partial?.isProxy ?? null,
        isTor: partial?.isTor ?? null,
        isAbuser: partial?.isAbuser ?? null,
      };
      if (country) return merged;
      partial = merged;
    }
  } catch {}

  try {
    const d = await fetchJsonWithTimeout("https://get.geojs.io/v1/ip/geo.json", timeoutMs);
    if (d && d.ip) {
      const country = String(d.country_code || "").toUpperCase();
      return {
        ok: true,
        source: partial ? `${partial.source} + geojs.io` : "geojs.io",
        ip: String(d.ip),
        country,
        countryName: String(d.country || partial?.countryName || ""),
        city: String(d.city || partial?.city || ""),
        timezone: String(d.timezone || partial?.timezone || ""),
        asn: partial?.asn ?? (typeof d.asn === "number" ? d.asn : null),
        org: partial?.org || String(d.organization_name || d.organization || ""),
        asnType: partial?.asnType || "",
        isDatacenter: partial?.isDatacenter ?? null,
        isVpn: partial?.isVpn ?? null,
        isProxy: partial?.isProxy ?? null,
        isTor: partial?.isTor ?? null,
        isAbuser: partial?.isAbuser ?? null,
      };
    }
  } catch {}

  return partial || { ok: false, source: "", ip: "", country: "" };
}

export async function lookupIpMetadata(ip, timeoutMs = 4500) {
  const cleanIp = String(ip || "").trim();
  if (!cleanIp) return null;
  try {
    const d = await fetchJsonWithTimeout(`https://api.ipapi.is/?q=${encodeURIComponent(cleanIp)}`, timeoutMs);
    const parsed = parseIpApiPayload(d);
    if (parsed) return parsed;
  } catch {}
  try {
    const d = await fetchJsonWithTimeout(`https://get.geojs.io/v1/ip/geo/${encodeURIComponent(cleanIp)}.json`, timeoutMs);
    if (d && d.ip) {
      return {
        ip: String(d.ip),
        country: String(d.country_code || "").toUpperCase(),
        countryName: String(d.country || ""),
        city: String(d.city || ""),
        timezone: String(d.timezone || ""),
        asn: typeof d.asn === "number" ? d.asn : null,
        org: String(d.organization_name || d.organization || ""),
        asnType: "",
        isDatacenter: null,
        isVpn: null,
        isProxy: null,
        isTor: null,
        isAbuser: null,
      };
    }
  } catch {}
  return null;
}

export function probeWebRTC(timeoutMs = 3800) {
  if (typeof window === "undefined") {
    return Promise.resolve({ supported: false, blocked: false, publicIps: [], localIps: [], mdnsCount: 0, srflxCount: 0 });
  }
  const RTCPC = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
  if (!RTCPC) {
    return Promise.resolve({ supported: false, blocked: true, publicIps: [], localIps: [], mdnsCount: 0, srflxCount: 0 });
  }

  return new Promise((resolve) => {
    const publicIps = new Set();
    const localIps = new Set();
    let mdnsCount = 0;
    let srflxCount = 0;
    let done = false;
    let pc;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        pc?.close();
      } catch {}
      resolve({
        supported: true,
        blocked: false,
        publicIps: [...publicIps],
        localIps: [...localIps],
        mdnsCount,
        srflxCount,
      });
    };

    const timer = setTimeout(finish, timeoutMs);

    try {
      pc = new RTCPC({
        iceServers: [
          { urls: "stun:stun.cloudflare.com:3478" },
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });
      pc.createDataChannel("env-check");
      pc.onicecandidate = (ev) => {
        if (!ev?.candidate?.candidate) {
          if (ev?.candidate === null) finish();
          return;
        }
        const cand = ev.candidate.candidate;
        if (cand.includes(" typ srflx")) srflxCount += 1;
        const parts = cand.split(/\s+/);
        const addr = parts[4];
        if (!addr || addr === "0.0.0.0" || addr === "::") return;
        if (addr.endsWith(".local")) {
          mdnsCount += 1;
        } else if (isPrivateIp(addr)) {
          localIps.add(addr);
        } else if (/^[\da-f:.]+$/i.test(addr)) {
          publicIps.add(addr);
        }
      };
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === "complete") finish();
      };
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch(() => finish());
    } catch {
      finish();
    }
  });
}

const GEO_NAME_TO_COUNTRY = {
  china: "CN",
  "hong kong": "HK",
  macao: "MO",
  macau: "MO",
  taiwan: "TW",
  "united states": "US",
  usa: "US",
  japan: "JP",
  singapore: "SG",
  "united kingdom": "GB",
  uk: "GB",
  germany: "DE",
  france: "FR",
  netherlands: "NL",
  canada: "CA",
  australia: "AU",
  "south korea": "KR",
  "korea, republic of": "KR",
  russia: "RU",
  "russian federation": "RU",
  belarus: "BY",
  iran: "IR",
  "north korea": "KP",
  syria: "SY",
  cuba: "CU",
};

export function parseEdnsGeo(geoText) {
  const raw = String(geoText || "").trim();
  if (!raw) return { country: "", countryName: "", org: "" };
  const idx = raw.indexOf(" - ");
  const countryName = (idx >= 0 ? raw.slice(0, idx) : raw).trim();
  const org = (idx >= 0 ? raw.slice(idx + 3) : "").trim();
  const country = GEO_NAME_TO_COUNTRY[countryName.toLowerCase()] || "";
  return { country, countryName, org };
}

function randomHex(len = 32) {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(Math.ceil(len / 2));
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, len);
  }
  let out = "";
  while (out.length < len) {
    out += Math.floor(Math.random() * 0x100000000)
      .toString(16)
      .padStart(8, "0");
  }
  return out.slice(0, len);
}

/**
 * 浏览器侧 DNS 泄露探测：
 *   1. 主源 bash.ws：并行触发 3 个随机子域 DNS 解析，再拉取权威 NS 记录到的全部递归解析器（含国家与 ASN）。
 *   2. 降级源 edns.ip-api.com：单次随机 32 位十六进制子域请求，直接返回出口递归 DNS IP 与归属地。
 */
export async function probeDnsLeak(timeoutMs = 5500) {
  try {
    const tid = String(1000000 + Math.floor(Math.random() * 8999999));
    const pingTimeout = Math.min(2200, timeoutMs);
    await Promise.allSettled(
      [1, 2, 3].map(async (n) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), pingTimeout);
        try {
          await fetch(`https://${n}.${tid}.bash.ws/`, {
            mode: "no-cors",
            cache: "no-store",
            credentials: "omit",
            signal: ctrl.signal,
          });
        } catch {
          // 即使 HTTPS 握手失败或被中断，浏览器发出的 DNS 查询已到达权威 NS
        } finally {
          clearTimeout(timer);
        }
      }),
    );

    await new Promise((r) => setTimeout(r, 180));
    const list = await fetchJsonWithTimeout(`https://bash.ws/dnsleak/test/${tid}?json`, Math.min(3500, timeoutMs));
    if (Array.isArray(list)) {
      const seen = new Set();
      const servers = [];
      for (const item of list) {
        if (item?.type !== "dns" || !item.ip || seen.has(item.ip)) continue;
        seen.add(item.ip);
        servers.push({
          ip: String(item.ip),
          country: String(item.country || "").toUpperCase(),
          countryName: String(item.country_name || ""),
          asn: String(item.asn || ""),
          org: String(item.org || ""),
        });
      }
      if (servers.length > 0) {
        return { ok: true, source: "bash.ws", servers };
      }
    }
  } catch {}

  try {
    const h32 = randomHex(32);
    const data = await fetchJsonWithTimeout(`https://${h32}.edns.ip-api.com/json`, Math.min(4000, timeoutMs));
    if (data?.dns?.ip) {
      const parsed = parseEdnsGeo(data.dns.geo);
      return {
        ok: true,
        source: "edns.ip-api.com",
        servers: [
          {
            ip: String(data.dns.ip),
            country: parsed.country,
            countryName: parsed.countryName,
            asn: "",
            org: parsed.org,
          },
        ],
      };
    }
  } catch {}

  return { ok: false, source: "", servers: [] };
}

export async function probeClaudeTargets(timeoutMs = 5500) {
  const bust = Date.now();
  const tasks = CLAUDE_TARGETS.map(async (target) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const start = performance.now();
    const sep = target.url.includes("?") ? "&" : "?";
    try {
      await fetch(`${target.url}${sep}_t=${bust}`, {
        mode: "no-cors",
        cache: "no-store",
        credentials: "omit",
        signal: ctrl.signal,
      });
      const rttMs = Math.max(1, Math.round(performance.now() - start));
      return { ...target, ok: true, rttMs };
    } catch (err) {
      return { ...target, ok: false, rttMs: null, error: err?.name === "AbortError" ? "超时" : "无法连接" };
    } finally {
      clearTimeout(timer);
    }
  });
  return Promise.all(tasks);
}

export function probeFonts(fontList) {
  if (typeof document === "undefined") return [];
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return [];
    const sample = "mmmmmmmmmmlli中文测试0123456789";
    const bases = ["monospace", "sans-serif", "serif"];
    const baseWidths = bases.map((b) => {
      ctx.font = `72px ${b}`;
      return ctx.measureText(sample).width;
    });
    const found = [];
    for (const font of fontList) {
      let matched = false;
      for (let i = 0; i < bases.length; i++) {
        ctx.font = `72px "${font}", ${bases[i]}`;
        if (Math.abs(ctx.measureText(sample).width - baseWidths[i]) > 0.5) {
          matched = true;
          break;
        }
      }
      if (matched) found.push(font);
    }
    return found;
  } catch {
    return [];
  }
}

export async function collectLocalSignals() {
  if (typeof window === "undefined") return null;
  const resolved = Intl.DateTimeFormat().resolvedOptions();
  const ua = navigator.userAgent || "";
  let model = "";
  let platform = navigator.platform || "";
  let brands = [];
  if (navigator.userAgentData) {
    brands = (navigator.userAgentData.brands || []).map((b) => b.brand).filter(Boolean);
    if (navigator.userAgentData.platform) platform = navigator.userAgentData.platform;
    try {
      const high = await navigator.userAgentData.getHighEntropyValues(["model", "platform"]);
      if (high?.model) model = high.model;
      if (high?.platform) platform = high.platform;
    } catch {}
  }

  return {
    timezone: resolved.timeZone || "",
    timezoneOffset: new Date().getTimezoneOffset(),
    intlLocale: resolved.locale || "",
    languages: Array.from(navigator.languages || (navigator.language ? [navigator.language] : [])),
    ua,
    brands,
    model,
    platform,
    isMac: /mac/i.test(platform) || /Macintosh|Mac OS X/i.test(ua),
    vendorFonts: probeFonts(CN_VENDOR_FONTS),
    commonCnFonts: probeFonts(COMMON_CN_FONTS),
  };
}

export function evaluateCheck({
  edge = null,
  claudeEdge = null,
  overseas = null,
  claudeTrace = null,
  webrtc = null,
  dns = null,
  claude = [],
  local = null,
} = {}) {
  const networkItems = [];
  const localItems = [];
  const fixes = [];

  const keywordEdge = claudeEdge?.ok ? claudeEdge : edge?.ok && edge.isClaudeKeywordHit ? edge : null;

  let activeNet = null;
  let exitMode = "none";
  if (claudeTrace?.ok) {
    activeNet = claudeTrace;
    exitMode = "claude_trace";
  } else if (keywordEdge?.ok) {
    activeNet =
      overseas?.ok && overseas.ip === keywordEdge.ip
        ? {
            ...overseas,
            ...keywordEdge,
            isDatacenter: keywordEdge.isDatacenter ?? overseas.isDatacenter,
            isVpn: keywordEdge.isVpn ?? overseas.isVpn,
            isProxy: keywordEdge.isProxy ?? overseas.isProxy,
            isTor: keywordEdge.isTor ?? overseas.isTor,
            isAbuser: keywordEdge.isAbuser ?? overseas.isAbuser,
            asnType: keywordEdge.asnType || overseas.asnType,
          }
        : keywordEdge;
    exitMode = "claude_keyword";
  } else if (overseas?.ok) {
    activeNet = overseas;
    exitMode = "overseas";
  } else if (edge?.ok) {
    activeNet = edge;
    exitMode = "site_edge";
  }

  const exitCountry = String(activeNet?.country || "").toUpperCase();
  const exitModeLabel =
    exitMode === "claude_trace"
      ? "claude.ai 实测"
      : exitMode === "claude_keyword"
        ? "claude 规则自动命中"
        : exitMode === "overseas"
          ? "通用海外路由"
          : exitMode === "site_edge"
            ? "当前站点边缘"
            : "未获取到";

  let ipTypeLabel = "未知网络";
  const netTags = [];

  // N1. 出口地区（权重 35）
  {
    const weight = 35;
    let score = 0;
    let status = "ok";
    let value = "未获取到出口 IP";
    let detail = "核对当前出口是否位于 Anthropic 支持地区。";

    if (!activeNet || !exitCountry) {
      score = 18;
      status = "warn";
      value = "海外出口超时";
      detail = "未能连上海外 IP 接口，请检查代理客户端是否已启动并接管浏览器流量。";
      netTags.push({ label: "地区未知", tone: "warn" });
      fixes.push({
        severity: "warn",
        title: "检查代理是否已接管浏览器流量",
        body: "海外 IP 接口响应超时。请确认代理客户端正常运行，且浏览器未绕过系统代理。",
      });
    } else if (BLOCKED_COUNTRIES.has(exitCountry)) {
      score = 35;
      status = "err";
      value = `${countryLabel(exitCountry, activeNet.countryName)} · ${activeNet.ip}`;
      detail = "出口位于 Anthropic 限制地区，登录或使用 Claude 极易触发拦截与封号。";
      netTags.push({ label: `地区受限 (${exitCountry})`, tone: "err" });
      fixes.push({
        severity: "err",
        title: "切换至 Anthropic 支持地区的节点",
        body: "Claude 限制中国大陆及港澳 IP。建议改用美国、日本、新加坡或欧洲等支持地区的稳定节点。",
      });
    } else {
      value = `${countryLabel(exitCountry, activeNet.countryName)}${activeNet.city ? ` · ${activeNet.city}` : ""}`;
      detail =
        exitMode === "claude_trace"
          ? `已按 claude.ai 实际出口 ${activeNet.ip}（节点 ${activeNet.colo || "-"}）核对，归属支持地区。`
          : exitMode === "claude_keyword"
            ? `已通过 ${activeNet.host || activeNet.source} 命中你的 Claude 分流节点（${activeNet.ip}，节点 ${activeNet.colo || "-"}），归属支持地区。`
            : `通用海外出口 ${activeNet.ip}（${activeNet.source}）归属支持地区。如为 claude.ai 单独分流，可展开上方校准框核对。`;
      netTags.push({ label: `地区支持 (${exitCountry})`, tone: "ok" });
    }

    networkItems.push({
      id: "overseas_region",
      title: exitMode === "claude_trace" || exitMode === "claude_keyword" ? "Claude 出口地区" : "海外出口地区",
      weight,
      score,
      status,
      value,
      detail,
      badge: exitModeLabel,
    });
  }

  // N2. IP 类型与纯净度（权重 25）
  {
    const weight = 25;
    let score = 0;
    let status = "ok";
    let value = "未识别";
    let detail = "区分家庭宽带与云机房、公开代理段，结合主流云与 IDC 特征库交叉判定。";

    const asn = activeNet?.asn ?? null;
    const org = activeNet?.org || activeNet?.asOrganization || "";
    const inferredDc = matchDatacenterByOrgOrAsn(asn, org);

    const hasApiFlags = activeNet && typeof activeNet.isDatacenter === "boolean";
    const isTor = Boolean(activeNet?.isTor);
    const isAbuser = Boolean(activeNet?.isAbuser);
    const isProxy = Boolean(activeNet?.isProxy);
    const isVpn = Boolean(activeNet?.isVpn);
    const isDc = hasApiFlags ? Boolean(activeNet.isDatacenter) || inferredDc : inferredDc;

    if (!activeNet) {
      status = "info";
      value = "等待获取出口";
      netTags.push({ label: "属性未知", tone: "info" });
    } else if (isTor || isAbuser || isProxy) {
      const flags = [isTor && "Tor 出口", isAbuser && "历史滥用", isProxy && "公开代理"].filter(Boolean);
      score = 25;
      status = "err";
      ipTypeLabel = "高危代理";
      value = flags.join(" / ");
      detail = `${org || (asn ? `AS${asn}` : activeNet.ip)} 命中公开代理或历史滥用记录，封号风险高。`;
      netTags.push({ label: "高危代理段", tone: "err" });
      fixes.push({
        severity: "err",
        title: "更换干净节点，避开共享代理池",
        body: `当前出口命中「${flags.join("、")}」。建议换用独享住宅 IP 或低复用率的干净节点。`,
      });
    } else if (isDc || isVpn) {
      score = 18;
      status = "warn";
      ipTypeLabel = isVpn ? "VPN 段" : "数据中心";
      value = `${isVpn ? "VPN 段" : "数据中心"}${org ? ` · ${org}` : asn ? ` · AS${asn}` : ""}`;
      detail = hasApiFlags
        ? "出口归属云机房或商业 VPN 段，较容易触发质询或身份核验，稳定性逊于原生住宅宽带。"
        : `识别出 ${org || `AS${asn}`} 属于云机房托管段。日常可用，但主力号建议搭配原生住宅 IP。`;
      netTags.push({ label: "云机房段", tone: "warn" });
      fixes.push({
        severity: "warn",
        title: "固定单一节点，主力号优先原生住宅 IP",
        body: `当前出口位于机房段（${org || `AS${asn}`}）。尽量固定节点减少跨区跳动；高价值账号可换用独享住宅 ISP。`,
      });
    } else if (hasApiFlags) {
      score = 0;
      status = "ok";
      ipTypeLabel = activeNet.asnType === "isp" ? "住宅宽带" : "非机房段";
      value = `${ipTypeLabel}${org ? ` · ${org}` : ""}`;
      detail = "未命中云机房、公开代理与滥用黑名单，出口质量良好。";
      netTags.push({ label: "非机房段", tone: "ok" });
      netTags.push({ label: "无代理标记", tone: "ok" });
    } else {
      status = "info";
      ipTypeLabel = "常规网络";
      value = org || (asn ? `AS${asn}` : "常规运营商");
      detail = "未命中常见云机房与托管商特征库，当前出口归属常规网络段。";
      netTags.push({ label: "常规网络段", tone: "info" });
    }

    networkItems.push({
      id: "ip_purity",
      title: "IP 类型与纯净度",
      weight,
      score,
      status,
      value,
      detail,
    });
  }

  // N3. WebRTC 地址泄露（权重 16）
  {
    const weight = 16;
    let score = 0;
    let status = "ok";
    let value = "待检测";
    let detail = "通过多组 STUN 节点检查浏览器是否绕过代理暴露本地或公网地址。";

    if (!webrtc) {
      status = "info";
    } else if (webrtc.blocked) {
      value = "已禁用 WebRTC";
      detail = "浏览器已关闭 RTCPeerConnection，彻底阻断 WebRTC 暴露路径。";
      netTags.push({ label: "WebRTC 已禁用", tone: "ok" });
    } else {
      const exposedPublic = (webrtc.publicIps || []).filter((ip) => ip !== activeNet?.ip);
      if (exposedPublic.length > 0) {
        score = 16;
        status = "err";
        value = `暴露公网 IP：${exposedPublic.slice(0, 2).join(", ")}`;
        detail = "WebRTC 暴露的公网地址与代理出口不一致，多由 IPv6 未走代理或 UDP 直连引起。";
        netTags.push({ label: "WebRTC 泄露", tone: "err" });
        fixes.push({
          severity: "err",
          title: "封堵 WebRTC 与 IPv6 泄露",
          body: "在代理客户端开启 Tun 模式接管 UDP 和 IPv6，或在浏览器启用 uBlock Origin 的防 WebRTC 泄露选项。",
        });
      } else if ((webrtc.publicIps || []).length > 0 && BLOCKED_COUNTRIES.has(exitCountry)) {
        score = 16;
        status = "err";
        value = `公网 IP：${webrtc.publicIps[0]}`;
        detail = "WebRTC 直接暴露了受限地区的公网地址。";
        netTags.push({ label: "WebRTC 泄露", tone: "err" });
      } else if ((webrtc.localIps || []).length > 0) {
        score = 5;
        status = "warn";
        value = `内网可见：${webrtc.localIps[0]}`;
        detail = "公网地址未暴露，但局域网私有 IP 可见，建议开启浏览器 mDNS 匿名隐藏。";
        netTags.push({ label: "内网 IP 可见", tone: "warn" });
      } else if (webrtc.mdnsCount > 0) {
        value = "已由 mDNS 隐藏";
        detail = "浏览器已用 .local 匿名地址替换本地网卡地址，无公网 IP 泄露。";
        netTags.push({ label: "WebRTC 安全", tone: "ok" });
      } else if ((webrtc.srflxCount || 0) === 0) {
        status = "info";
        value = "STUN 无回包（UDP 未转发）";
        detail = "当前代理未转发 STUN UDP 数据包，网页无法通过 STUN 获取真实 IP。";
        netTags.push({ label: "STUN 未转发", tone: "info" });
      } else {
        value = "与代理出口一致";
        detail = "STUN 返回的公网地址与当前出口吻合，未暴露其他真实 IP。";
        netTags.push({ label: "WebRTC 安全", tone: "ok" });
      }
    }

    networkItems.push({
      id: "webrtc_leak",
      title: "WebRTC 地址泄露",
      weight,
      score,
      status,
      value,
      detail,
    });
  }

  // N4. DNS 泄露检测（权重 14）
  {
    const weight = 14;
    let score = 0;
    let status = "ok";
    let value = "待检测";
    let detail = "通过随机子域名探针识别实际发出解析请求的递归 DNS 服务器归属地，排查本地宽带 DNS 泄露。";

    const servers = dns?.ok && Array.isArray(dns.servers) ? dns.servers : [];
    if (!dns) {
      status = "info";
    } else if (!dns.ok || servers.length === 0) {
      status = "info";
      value = "DNS 探测超时或被拦截";
      detail = "未能拿到递归 DNS 回传。建议在代理客户端开启 Fake-IP 与 Tun 模式，确保域名走远程解析。";
      netTags.push({ label: "DNS 未回传", tone: "info" });
    } else {
      const blockedServers = servers.filter((s) => BLOCKED_COUNTRIES.has(String(s.country || "").toUpperCase()));
      if (blockedServers.length > 0) {
        score = 14;
        status = "err";
        const blockedRegions = [...new Set(blockedServers.map((s) => countryLabel(s.country, s.countryName)))];
        const sample = blockedServers
          .slice(0, 2)
          .map((s) => (s.org ? `${s.ip}（${s.org}）` : s.ip))
          .join("、");
        value = `检出受限地区 DNS：${blockedRegions.slice(0, 2).join(" / ")}（${blockedServers.length}/${servers.length}）`;
        detail = `解析请求落入受限地区递归 DNS：${sample}。部分或全部域名解析绕过了代理，容易暴露真实地区。`;
        netTags.push({ label: "DNS 泄露", tone: "err" });
        fixes.push({
          severity: "err",
          title: "封堵本地 DNS 泄露",
          body: "检出受限地区 DNS 解析器。请在代理客户端开启 Fake-IP 与 Tun 模式，将 claude.ai 与 anthropic.com 的 DNS 解析全部交给远程节点处理，避免回退到本地宽带 DNS 或 223.5.5.5。",
        });
      } else {
        const regions = [
          ...new Set(servers.map((s) => (s.country ? countryLabel(s.country, s.countryName) : s.countryName)).filter(Boolean)),
        ];
        const sample = servers
          .slice(0, 2)
          .map((s) => (s.org ? `${s.ip} · ${s.org}` : s.ip))
          .join("；");
        value = `${servers.length} 个海外解析器 · ${regions.slice(0, 2).join(" / ") || "支持地区"}`;
        detail = `未检出受限地区递归 DNS（${sample}），域名解析已正常经由海外线路处理。`;
        netTags.push({ label: "DNS 无泄露", tone: "ok" });
      }
    }

    networkItems.push({
      id: "dns_leak",
      title: "DNS 泄露检测",
      weight,
      score,
      status,
      value,
      detail,
      badge: dns?.source || "",
    });
  }

  // N5. Claude 域名连通性（权重 10）
  {
    const weight = 10;
    let score = 0;
    let status = "ok";
    let value = "未检测";
    let detail = "并行测试 claude.ai、api.anthropic.com 与 www.anthropic.com 的连通状态和往返延迟。";

    if (claude.length > 0) {
      const okCount = claude.filter((c) => c.ok).length;
      const failHosts = claude.filter((c) => !c.ok).map((c) => c.host);
      const rtts = claude.filter((c) => c.ok && c.rttMs != null).map((c) => c.rttMs);
      const avgRtt = rtts.length ? Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length) : null;

      if (okCount === 0) {
        score = 10;
        status = "err";
        value = `0/${claude.length} 可达`;
        detail = "3 个核心域名均未响应，当前代理链路无法连通 Anthropic 服务。";
        netTags.push({ label: "域名不通", tone: "err" });
        fixes.push({
          severity: "err",
          title: "补全 Claude 与 Anthropic 分流规则",
          body: "将 DOMAIN-SUFFIX,claude.ai 与 DOMAIN-SUFFIX,anthropic.com 统一指向同一海外节点。",
        });
      } else if (okCount < claude.length) {
        score = 5;
        status = "warn";
        value = `${okCount}/${claude.length} 可达（${failHosts.join(", ")} 异常）`;
        detail = "部分子域未能连通，常见原因是代理规则遗漏了 anthropic.com。";
        netTags.push({ label: `域名 ${okCount}/${claude.length}`, tone: "warn" });
      } else {
        value = `${okCount}/${claude.length} 可达 · 平均 ${avgRtt} ms`;
        detail = "3 个核心域名均正常响应，网络通道畅通。";
        netTags.push({ label: "Claude 可达", tone: "ok" });
      }
    }

    networkItems.push({
      id: "claude_reachability",
      title: "Claude 域名连通性",
      weight,
      score,
      status,
      value,
      detail,
      targets: claude,
      wide: true,
    });
  }

  // N5. 多路分流对照（权重 0，跨两列展示）
  {
    let status = "info";
    let value = "单路结果";
    let detail = "横向对比当前 Worker 边缘与通用海外出口，一眼看清分流走向。";

    const routes = [];
    if (edge?.ok) routes.push(`Worker 边缘 ${countryLabel(edge.country)} (${edge.ip})`);
    if (claudeEdge?.ok && claudeEdge.ip !== edge?.ip) routes.push(`Claude 探针 ${countryLabel(claudeEdge.country)} (${claudeEdge.ip})`);
    if (overseas?.ok) routes.push(`通用海外 ${countryLabel(overseas.country)} (${overseas.ip})`);

    const uniqueIps = new Set([edge?.ip, claudeEdge?.ip, overseas?.ip].filter(Boolean));
    if (uniqueIps.size === 1 && routes.length >= 2) {
      status = "ok";
      value = `全局统一出口 · ${activeNet?.ip}`;
      detail = `各路流量走向同一出口（${routes.join(" / ")}），无跨节点分裂。`;
    } else if (routes.length >= 2) {
      status = "info";
      value = `按规则分流（${uniqueIps.size} 个出口）`;
      detail = routes.join(" ｜ ");
    } else if (routes.length === 1) {
      value = routes[0];
    }

    networkItems.push({
      id: "split_routing",
      title: "多路分流对照",
      weight: 0,
      score: 0,
      status,
      value,
      detail,
      badge: "分流视图",
      wide: true,
    });
  }

  const networkRiskScore = Math.min(100, networkItems.reduce((sum, it) => sum + it.score, 0));
  const networkRiskLevel = networkRiskScore >= 50 ? "high" : networkRiskScore >= 18 ? "medium" : "low";
  const networkSummary =
    networkRiskLevel === "high"
      ? "出口地区受限、命中高危代理段或存在 WebRTC / DNS 泄露，建议先调整节点后再登录 Claude。"
      : networkRiskLevel === "medium"
        ? "出口地区符合要求，但归属云机房段或存在次要链路隐患，建议固定节点使用。"
        : "出口位于支持地区，未命中云机房黑名单、公开代理或 WebRTC / DNS 泄露，网络环境干净。";

  // ===================== 二、本地指纹风险（0–100，越低越安全，8 项独立拆解） =====================
  const localTz = local?.timezone || "";
  const localOffsetMin = local ? -(local.timezoneOffset || 0) : null;
  const localOffsetStr = formatUtcOffset(localOffsetMin);
  const ipTz = activeNet?.timezone || COUNTRY_DEFAULT_TZ[exitCountry] || "";
  const ipOffsetMin = timezoneOffsetMinutes(ipTz);
  const ipOffsetStr = formatUtcOffset(ipOffsetMin);
  const diffHours =
    localOffsetMin != null && ipOffsetMin != null
      ? Math.round((Math.abs(localOffsetMin - ipOffsetMin) / 60) * 10) / 10
      : null;

  // L1. 系统与出口时区匹配（权重 28）
  {
    const weight = 28;
    let score = 0;
    let status = "ok";
    let value = localTz || "未知";
    let detail = "核对系统时区是否落在中国大陆/港澳，并计算本机与出口 IP 所在时区的小时差。";

    if (local) {
      value = ipTz
        ? `本机 ${localTz} (${localOffsetStr}) ↔ 出口 ${ipTz} (${ipOffsetStr})`
        : `${localTz} (${localOffsetStr})`;

      if (CN_TIMEZONES.has(localTz)) {
        score = 28;
        status = "err";
        detail = `系统时区为 ${localTz}，直接暴露受限地区环境${diffHours != null && diffHours > 0 ? `，且与出口时区相差 ${diffHours} 小时` : ""}。`;
        fixes.push({
          severity: "err",
          title: "将时区对齐至出口节点所在地区",
          body: `当前系统时区为 ${localTz}。可在专用浏览器配置中隔离时区，或将系统时区改为与出口一致（如 ${ipTz || "目标地区时区"}）。`,
        });
      } else if (diffHours != null && diffHours > 3) {
        score = 18;
        status = "err";
        detail = `出口时区为 ${ipTz} (${ipOffsetStr})，本机时区为 ${localTz} (${localOffsetStr})，相差 ${diffHours} 小时，跨区错位明显。`;
        fixes.push({
          severity: "err",
          title: `消除 ${diffHours} 小时的「出口 ↔ 本机」时区差`,
          body: `出口位于 ${countryLabel(exitCountry)}（${ipTz}），而本机为 ${localTz}。换用同区节点，或将浏览器时区调整为 ${ipTz}。`,
        });
      } else if (diffHours != null && diffHours > 0) {
        score = 6;
        status = "warn";
        detail = `出口时区（${ipTz}）与本机时区（${localTz}）相差 ${diffHours} 小时，属同大区轻度偏移，可按需完全对齐。`;
      } else {
        detail = ipTz
          ? `本机（${localOffsetStr}）与出口（${ipOffsetStr}）时差为 0 小时，时空完全对齐。`
          : "未命中受限地区时区。";
      }
    }

    localItems.push({
      id: "system_timezone",
      title: "系统与出口时区匹配",
      weight,
      score,
      status,
      value,
      detail,
      badge: "Claude Code 同款",
    });
  }

  // L2. 浏览器语言与请求头（权重 20）
  {
    const weight = 20;
    let score = 0;
    let status = "ok";
    let value = "未知";
    let detail = "检查 navigator.languages 与请求头 Accept-Language 是否携带简体中文（zh-CN）。";

    if (local) {
      const langs = local.languages || [];
      const first = String(langs[0] || "").toLowerCase();
      const headerLang = String(edge?.acceptLanguage || claudeEdge?.acceptLanguage || "").toLowerCase();
      const hasZhCnFirst = first.startsWith("zh-cn") || first === "zh-hans" || first.startsWith("zh-hans-cn");
      const hasZhAnywhere = langs.some((l) => String(l).toLowerCase().startsWith("zh-cn")) || headerLang.includes("zh-cn");

      value = langs.slice(0, 3).join(", ") || "未声明";
      if (hasZhCnFirst) {
        score = 20;
        status = "err";
        detail = "浏览器首选语言为简体中文（zh-CN），访问网页端时会随每次请求发出。";
        fixes.push({
          severity: "warn",
          title: "为 Claude 准备纯英文的独立浏览器配置",
          body: "在 Chrome 新建专用 Profile，将首选语言设为 English (United States) 并移出 zh-CN，与日常中文浏览隔离。",
        });
      } else if (hasZhAnywhere) {
        score = 10;
        status = "warn";
        detail = "首选语言为英文，但备选语言列表或请求头里仍保留着 zh-CN。";
        fixes.push({
          severity: "warn",
          title: "从浏览器备选语言中移出 zh-CN",
          body: "当前请求头仍会附带 zh-CN，建议在专用浏览器配置中只保留 en-US 与 en。",
        });
      } else {
        detail = "首选语言与请求头均无 zh-CN 标识。";
      }
    }

    localItems.push({
      id: "browser_language",
      title: "浏览器语言与请求头",
      weight,
      score,
      status,
      value,
      detail,
    });
  }

  // L3. 国产厂商与软件字体（权重 14）
  {
    const weight = 14;
    let score = 0;
    let status = "ok";
    let value = "未检出";
    let detail = "探测 MiSans、HarmonyOS Sans、OPPO Sans、WPS 方正等国内厂商与软件特供字体。";

    if (local) {
      const vFonts = local.vendorFonts || [];
      if (vFonts.length > 0) {
        score = 14;
        status = "err";
        value = vFonts.slice(0, 3).join(", ");
        detail = "检出国内厂商或办公软件特供字体，即使更改语言与时区，仍会留下鲜明本地特征。";
      }
    }

    localItems.push({
      id: "cn_vendor_fonts",
      title: "国产厂商与软件字体",
      weight,
      score,
      status,
      value,
      detail,
    });
  }

  // L4. 国产浏览器 / WebView（权重 12）
  {
    const weight = 12;
    let score = 0;
    let status = "ok";
    let value = "未检出";
    let detail = "匹配 UA 与 UA-CH 中的微信、QQ、夸克、UC、百度、360 等国产浏览器或内置 WebView。";

    if (local) {
      const uaAndBrands = `${local.ua} ${(local.brands || []).join(" ")}`;
      const m = uaAndBrands.match(CN_BROWSER_RE);
      if (m) {
        score = 12;
        status = "err";
        value = m[0];
        detail = "当前处于国产浏览器或内置 WebView，建议换用国际版 Chrome 或 Firefox 访问。";
        fixes.push({
          severity: "warn",
          title: "换用国际版 Chrome 或 Firefox 访问 Claude",
          body: `检出 ${m[0]} 标识。请在原版国际浏览器中登录和操作主力账号。`,
        });
      }
    }

    localItems.push({
      id: "cn_browser",
      title: "国产浏览器 / WebView",
      weight,
      score,
      status,
      value,
      detail,
    });
  }

  // L5. 国产品牌设备标识（权重 8）
  {
    const weight = 8;
    let score = 0;
    let status = "ok";
    let value = "未检出";
    let detail = "核对 UA 与 UA-CH 设备型号中是否带有鸿蒙、华为、小米、OPPO、vivo 等品牌标识。";

    if (local) {
      const m = `${local.model} ${local.ua}`.match(CN_DEVICE_RE);
      if (m) {
        score = 8;
        status = "warn";
        value = m[0];
        detail = "移动端 UA 暴露了国产品牌设备型号，重要账号建议优先在桌面端操作。";
      }
    }

    localItems.push({
      id: "cn_device",
      title: "国产品牌设备标识",
      weight,
      score,
      status,
      value,
      detail,
    });
  }

  // L6. Intl 区域设置（权重 8）
  {
    const weight = 8;
    let score = 0;
    let status = "ok";
    let value = local?.intlLocale || "未知";
    let detail = "检查浏览器用于日期和数字格式化的 Intl 默认区域设置。";

    if (local) {
      const intl = String(local.intlLocale || "");
      value = intl || "未知";
      if (/^zh(-hans)?-cn$/i.test(intl)) {
        score = 8;
        status = "warn";
        detail = `Intl 区域格式为 ${intl}，与英文/海外环境存在明显反差。`;
      } else {
        detail = "Intl 区域格式未指向简体中文区域。";
      }
    }

    localItems.push({
      id: "intl_locale",
      title: "Intl 区域设置",
      weight,
      score,
      status,
      value,
      detail,
    });
  }

  // L7. 系统常见中文字体（权重 6）
  {
    const weight = 6;
    let score = 0;
    let status = "ok";
    let value = "未检出";
    let detail = "探测微软雅黑、苹方等常见中文字体；macOS 出厂默认预装苹方等字体，属于正常系统环境，不计风险分。";

    if (local) {
      const fonts = local.commonCnFonts || [];
      const nonMacFonts = local.isMac ? fonts.filter((f) => !MAC_DEFAULT_CN_FONTS.has(f)) : fonts;
      if (fonts.length > 0) {
        value = `${fonts.slice(0, 3).join(", ")}${fonts.length > 3 ? ` 等 ${fonts.length} 款` : ""}`;
      }
      if (nonMacFonts.length >= 2) {
        score = 6;
        status = "warn";
        detail = "系统安装了多款简体中文字体，单独出现影响较小，配合英文语言与对齐时区即可。";
      } else if (local.isMac && fonts.length > 0) {
        status = "ok";
        detail = "检出的 PingFang SC、STSong 等为 macOS 全球出厂自带字体，不计风险分。";
      }
    }

    localItems.push({
      id: "common_cn_fonts",
      title: "系统常见中文字体",
      weight,
      score,
      status,
      value,
      detail,
    });
  }

  // L8. 系统时区偏移（权重 4）
  {
    const weight = 4;
    let score = 0;
    let status = "ok";
    let value = localOffsetStr || "未知";
    let detail = "检查 getTimezoneOffset() 是否落在 UTC+8，并与出口所在时区交叉对照。";

    if (local) {
      if (localOffsetMin === 480 && exitCountry && !UTC8_SAFE_COUNTRIES.has(exitCountry)) {
        score = 4;
        status = "warn";
        detail = `本机偏移为 UTC+8，而出口位于非 UTC+8 地区（${countryLabel(exitCountry)}）。`;
      } else if (localOffsetMin === 480 && CN_TIMEZONES.has(localTz)) {
        score = 4;
        status = "warn";
        detail = "本机偏移为 UTC+8 且系统时区落在中国大陆/港澳。";
      } else {
        detail = localOffsetMin === 480 ? "本机偏移为 UTC+8，与当前出口时区一致。" : "非 UTC+8 偏移，无冲突。";
      }
    }

    localItems.push({
      id: "timezone_offset",
      title: "系统时区偏移",
      weight,
      score,
      status,
      value,
      detail,
    });
  }

  const localRiskScore = Math.min(100, localItems.reduce((sum, it) => sum + it.score, 0));
  const localRiskLevel = localRiskScore >= 50 ? "high" : localRiskScore >= 20 ? "medium" : "low";
  const localRiskSummary =
    localRiskLevel === "high"
      ? "本地环境存在明显中国区特征或跨时区错位，建议按下方清单完成隔离。"
      : localRiskLevel === "medium"
        ? "本地环境有局部中文或时区偏差，主力账号建议按命中项做进一步纯化。"
        : "时区对齐，未检出简体中文首选语言与国产特征，本地环境干净。";

  return {
    network: {
      riskScore: networkRiskScore,
      riskLevel: networkRiskLevel,
      ipTypeLabel,
      summary: networkSummary,
      tags: netTags,
      items: networkItems,
    },
    local: {
      riskScore: localRiskScore,
      riskLevel: localRiskLevel,
      summary: localRiskSummary,
      items: localItems,
    },
    fixes,
    edge,
    claudeEdge,
    overseas,
    claudeTrace,
    dns,
    activeNet,
    exitMode,
    exitModeLabel,
    usingClaudeExact: exitMode === "claude_trace" || exitMode === "claude_keyword",
  };
}

export function buildEnvCheckAiPrompt(result, { url = "", compact = false } = {}) {
  const netHits = (result?.network?.items || []).filter((it) => it.score > 0);
  const localHits = (result?.local?.items || []).filter((it) => it.score > 0);
  const netLabel = result?.network?.riskLevel === "high" ? "高风险" : result?.network?.riskLevel === "medium" ? "中风险" : "低风险";
  const localLabel = result?.local?.riskLevel === "high" ? "高风险" : result?.local?.riskLevel === "medium" ? "中风险" : "低风险";

  const lines = [
    "我刚用 ClaudeCheck 做了一次 Claude 访问环境与 IP 安全检测，请你作为网络与浏览器隔离专家，根据下面的实测结果帮我制定一套系统性的加固方案：",
    "",
    "【核心结论】（两项独立打分，0–100 越低越安全）",
    `- 网络与代理风险：${result?.network?.riskScore ?? 0}/100（${netLabel} · ${result?.network?.ipTypeLabel || "未知"} · 来源：${result?.exitModeLabel || "未知"}）`,
    `- 本地指纹风险：${result?.local?.riskScore ?? 0}/100（${localLabel}）`,
  ];

  if (result?.activeNet?.ip) {
    lines.push(
      `- 出口信息：${countryLabel(result.activeNet.country, result.activeNet.countryName)}${result.activeNet.city ? ` ${result.activeNet.city}` : ""}｜${result.activeNet.asn ? `AS${result.activeNet.asn} ` : ""}${result.activeNet.org || ""}`,
    );
  }

  lines.push("", "【命中的风险项】");
  if (netHits.length === 0 && localHits.length === 0) {
    lines.push("- 当前未命中明显风险项（网络与本地指纹均为 0 分）。请帮我检查还有哪些网页端测不到的盲区（例如多账号 Cookie 隔离、支付卡区匹配、Claude Code 终端代理一致性）。");
  } else {
    for (const it of netHits) {
      lines.push(`- [网络 +${it.score}] ${it.title}：${it.value}${compact ? "" : `（${it.detail}）`}`);
    }
    for (const it of localHits) {
      lines.push(`- [本地 +${it.score}] ${it.title}：${it.value}${compact ? "" : `（${it.detail}）`}`);
    }
  }

  if (!compact) {
    const split = (result?.network?.items || []).find((it) => it.id === "split_routing");
    if (split?.value) lines.push(`- [分流参考] ${split.value}`);
  }

  lines.push(
    "",
    "请按「高危优先 → 中危其次 → 长期习惯」的顺序，给出具体可落地的操作步骤（请先问我 1～2 个关键前提，例如操作系统、主力代理客户端以及是否使用 Claude Code CLI，然后给出精确配置建议）。",
  );
  if (url) lines.push(`检测页：${url}`);

  return lines.join("\n");
}

export function envCheckAskPlan(target, result, opts = {}) {
  const home = { url: target.home || target.url(""), filled: false };
  if (!target.fill) return home;
  for (const compact of [false, true]) {
    const prompt = buildEnvCheckAiPrompt(result, { ...opts, compact });
    const url = target.url(prompt);
    if (url.length <= target.max) return { url, filled: true };
  }
  return home;
}
