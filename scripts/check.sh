#!/usr/bin/env bash
# ClaudeCheck CLI — 终端 / Claude Code 环境与 IP 风险一行自检脚本
# 用法：curl -fsSL https://raw.githubusercontent.com/gm365/ClaudeCheck/main/scripts/check.sh | bash
# 选项：--strict（检出高风险时以退出码 2 结束，便于脚本集成）
# 隐私：全部检测在本地终端运行，零遥测、零日志留存。

set -u

STRICT_MODE=0
for arg in "$@"; do
  case "$arg" in
    --strict) STRICT_MODE=1 ;;
    -h|--help)
      echo "ClaudeCheck CLI - Claude / Claude Code 终端环境与 IP 风险自检"
      echo "用法: bash check.sh [--strict]"
      exit 0
      ;;
  esac
done

# 颜色控制（非 TTY 或设置 NO_COLOR 时自动关闭）
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET='\033[0m'
  C_BOLD='\033[1m'
  C_DIM='\033[2m'
  C_OK='\033[32m'
  C_WARN='\033[33m'
  C_ERR='\033[31m'
  C_INFO='\033[36m'
else
  C_RESET=''; C_BOLD=''; C_DIM=''; C_OK=''; C_WARN=''; C_ERR=''; C_INFO=''
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "错误：未找到 curl，请先安装 curl 后重试。" >&2
  exit 1
fi

UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

NET_SCORE=0
LOCAL_SCORE=0
FIXES=()

add_fix() {
  FIXES+=("$1")
}

is_blocked_country() {
  case "$1" in
    CN|HK|MO|RU|BY|KP|IR|SY|CU) return 0 ;;
    *) return 1 ;;
  esac
}

is_dc_asn() {
  case "$1" in
    16509|14618|8987|15169|396982|8075|8068|13335|209242|54113|20940|16625|63949|14061|20473|24940|213230|16276|31898|36351|45102|37963|24429|132203|45090|132591|136907|55990|139080|138699|396986|135377|38365|55967|59019|2914|4714|9268|174|6939|3257|1299|3356|6461|6453|3491|4637|9002|137409|21859|40065|906|54574|25820|3214|4842|6233|9312|917|57695|138997|141995|139317|44735|136766|7684|9370|7506|18077|131965|136800|55933|9009|212238|60068|60781|28753|16265|60626|51167|40021|199524|147049|40676|46844|8100|53667|36352|35916|29802|3223|50673|49981|62240|12876|8560|47583|36007|202053|54825|16552|396356|399646|136787|51852|46562|39351|11878|36236)
      return 0 ;;
    *) return 1 ;;
  esac
}

is_residential_asn() {
  case "$1" in
    4713|9605|2516|17676|4760|9269|1221|3462|4780|9924|7922|7018|701|22394|20115)
      return 0 ;;
    *) return 1 ;;
  esac
}

is_dc_org() {
  printf '%s' "$1" | grep -Eiq 'Zenlayer|SpeedyCloud|Amazon|AWS|Google[[:space:]]+(Cloud|LLC)|Microsoft|Azure|DigitalOcean|Vultr|Choopa|Linode|Akamai|Cloudflare|Fastly|Hetzner|OVH|Oracle|IBM[[:space:]]+Cloud|SoftLayer|Alibaba|Aliyun|Tencent|Huawei[[:space:]]+Cloud|ByteDance|Volcano[[:space:]]*Engine|UCloud|Baidu|Kingsoft|NTT[[:space:]]+(America|Communications|PC|Ltd|DATA|Global)|NTT-?GIN|Cogent|Hurricane[[:space:]]+Electric|GTT[[:space:]]+Communications|Arelion|Twelve99|Telia[[:space:]]+Carrier|Zayo|AboveNet|Tata[[:space:]]+Communications|PCCW[[:space:]]+Global|Telstra[[:space:]]+(Global|International)|GSL[[:space:]]+Networks|RETN|DMIT|Bandwagon|IT7|M247|DataCamp|CDN77|LeaseWeb|Contabo|G-?Core|Packethub|Psychz|Sharktech|QuadraNet|FranTech|BuyVM|ColoCrossing|RackNerd|Misaka|xTom|V\.PS|Akari[[:space:]]+Networks|Nearoute|Kirino|RFCHOST|Sakura[[:space:]]+Internet|GMO[[:space:]]+Internet|ConoHa|Kagoya|Xserver|LayerStack|Dataplugs|Cloudie|Multacom|Hivelocity|Voxility|Serverius|WorldStream|Clouvider|Scaleway|Online[[:space:]]+S\.A\.S|IONOS|Hostinger|Kamatera|UpCloud|Equinix[[:space:]]+Metal|Maxihost|Latitude\.sh|CeraNetworks|CloudCone|Spartan[[:space:]]*Host|GreenCloud|VirMach|Hostodo|Hyonix|Tefincom|NordVPN|Private[[:space:]]+Layer|Performive|31173[[:space:]]+Services|Mullvad|NetActuate|Tzulo|Hosting|Datacenter|Data[[:space:]]*Center|Cloud[[:space:]]+Computing|Colocation|Dedicated[[:space:]]+Server|\b(VPS|IDC)\b'
}

json_str() {
  # 轻量提取 JSON 字符串字段（无 jq 依赖）
  local json="$1" key="$2"
  printf '%s' "$json" | tr '\n' ' ' | sed -nE "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\1/p" | head -n 1
}

json_num() {
  local json="$1" key="$2"
  printf '%s' "$json" | tr '\n' ' ' | sed -nE "s/.*\"${key}\"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p" | head -n 1
}

json_bool() {
  local json="$1" key="$2"
  printf '%s' "$json" | tr '\n' ' ' | sed -nE "s/.*\"${key}\"[[:space:]]*:[[:space:]]*(true|false).*/\1/p" | head -n 1
}

rand_hex32() {
  if [ -r /dev/urandom ] && command -v od >/dev/null 2>&1; then
    od -An -tx1 -N16 /dev/urandom 2>/dev/null | tr -d ' \n'
  else
    printf '%08x%08x%08x%08x' "$$" "$(date +%s)" "$RANDOM" "$((RANDOM * 32768 + RANDOM))"
  fi
}

print_row() {
  local tag="$1" color="$2" label="$3" value="$4"
  printf "  ${color}[%s]${C_RESET} ${C_BOLD}%-14s${C_RESET} %s\n" "$tag" "$label" "$value"
}

printf "\n${C_BOLD}ClaudeCheck CLI${C_RESET} ${C_DIM}— 终端 / Claude Code 环境与 IP 风险自检${C_RESET}\n"
printf "${C_DIM}────────────────────────────────────────────────────────────${C_RESET}\n"

# 1. 代理环境变量检查
PROXY_HTTPS="${HTTPS_PROXY:-${https_proxy:-}}"
PROXY_HTTP="${HTTP_PROXY:-${http_proxy:-}}"
PROXY_ALL="${ALL_PROXY:-${all_proxy:-}}"
PROXY_NO="${NO_PROXY:-${no_proxy:-}}"

if [ -n "$PROXY_HTTPS" ] || [ -n "$PROXY_ALL" ] || [ -n "$PROXY_HTTP" ]; then
  ACTIVE_PROXY="${PROXY_HTTPS:-${PROXY_ALL:-$PROXY_HTTP}}"
  print_row "INFO" "$C_INFO" "终端代理变量" "$ACTIVE_PROXY"
else
  print_row "INFO" "$C_INFO" "终端代理变量" "未设置 HTTP(S)_PROXY / ALL_PROXY（如使用 Tun 透明代理属正常）"
fi

if printf '%s' "$PROXY_NO" | grep -Eiq '(claude\.ai|anthropic\.com)'; then
  print_row "WARN" "$C_WARN" "NO_PROXY 冲突" "NO_PROXY 包含 claude.ai 或 anthropic.com，终端请求将绕过代理！"
  add_fix "从 NO_PROXY / no_proxy 中移除 claude.ai 与 anthropic.com。"
fi

# 2. 实测 claude.ai 出口（cdn-cgi/trace）
TRACE_RAW="$(curl -fsSL --max-time 7 -A "$UA" "https://claude.ai/cdn-cgi/trace" 2>/dev/null || true)"
EXIT_IP=""
EXIT_LOC=""
EXIT_COLO=""
EXIT_TLS=""
EXIT_HTTP=""

if [ -n "$TRACE_RAW" ]; then
  EXIT_IP="$(printf '%s\n' "$TRACE_RAW" | awk -F= '$1=="ip"{print $2; exit}')"
  EXIT_LOC="$(printf '%s\n' "$TRACE_RAW" | awk -F= '$1=="loc"{print toupper($2); exit}')"
  EXIT_COLO="$(printf '%s\n' "$TRACE_RAW" | awk -F= '$1=="colo"{print $2; exit}')"
  EXIT_TLS="$(printf '%s\n' "$TRACE_RAW" | awk -F= '$1=="tls"{print $2; exit}')"
  EXIT_HTTP="$(printf '%s\n' "$TRACE_RAW" | awk -F= '$1=="http"{print $2; exit}')"
fi

if [ -z "$EXIT_IP" ]; then
  NET_SCORE=$((NET_SCORE + 20))
  print_row "FAIL" "$C_ERR" "claude.ai 出口" "无法连接 claude.ai/cdn-cgi/trace（超时或被阻断）"
  add_fix "确认终端代理已生效（开启 Tun 模式或导出 HTTPS_PROXY=http://127.0.0.1:<端口>）。"
elif is_blocked_country "$EXIT_LOC"; then
  NET_SCORE=$((NET_SCORE + 40))
  print_row "FAIL" "$C_ERR" "claude.ai 出口" "${EXIT_LOC} · ${EXIT_IP}（节点 ${EXIT_COLO:-"-"}，受限地区！）"
  add_fix "当前终端访问 claude.ai 的出口位于受限地区（${EXIT_LOC}），请立即切换至美/日/新/欧等支持地区节点。"
else
  print_row "PASS" "$C_OK" "claude.ai 出口" "${EXIT_LOC} · ${EXIT_IP}（节点 ${EXIT_COLO:-"-"} · ${EXIT_HTTP:-"-"} / ${EXIT_TLS:-"-"}）"
fi

# 3. IP 类型与机房纯净度
IP_ASN=""
IP_ORG=""
IP_TZ=""
IS_DC=""
IS_VPN=""
IS_PROXY=""
IS_TOR=""
IS_ABUSER=""

if [ -n "$EXIT_IP" ]; then
  IPAPI_JSON="$(curl -fsSL --max-time 6 -A "$UA" "https://api.ipapi.is/?q=${EXIT_IP}" 2>/dev/null || true)"
  if [ -n "$IPAPI_JSON" ] && printf '%s' "$IPAPI_JSON" | grep -q '"ip"'; then
    if command -v python3 >/dev/null 2>&1; then
      eval "$(printf '%s' "$IPAPI_JSON" | python3 -c '
import json, re, shlex, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
raw_asn = d.get("asn")
raw_comp = d.get("company")
raw_loc = d.get("location")
asn = ""
org = ""
if isinstance(raw_asn, dict):
    asn = str(raw_asn.get("asn") or "")
    org = str(raw_asn.get("org") or "")
elif isinstance(raw_asn, str):
    m = re.match(r"^AS(\d+)\s*(.*)$", raw_asn.strip(), re.I)
    if m:
        asn, org = m.group(1), m.group(2).strip()
if not org:
    if isinstance(raw_comp, dict):
        org = str(raw_comp.get("name") or "")
    elif isinstance(raw_comp, str):
        org = raw_comp.strip()
tz = str((raw_loc.get("timezone") if isinstance(raw_loc, dict) else None) or d.get("timezone") or "")
def b(k): return "true" if d.get(k) is True else ("false" if d.get(k) is False else "")
for k, v in [("IP_ASN", asn), ("IP_ORG", org), ("IP_TZ", tz),
             ("IS_DC", b("is_datacenter")), ("IS_VPN", b("is_vpn")),
             ("IS_PROXY", b("is_proxy")), ("IS_TOR", b("is_tor")), ("IS_ABUSER", b("is_abuser"))]:
    print(f"{k}={shlex.quote(v)}")
' 2>/dev/null || true)"
    else
      IP_ASN="$(printf '%s' "$IPAPI_JSON" | grep -Eo '"asn"[[:space:]]*:[[:space:]]*("AS[0-9]+|[0-9]+)' | head -n 1 | grep -Eo '[0-9]+')"
      IP_ORG="$(printf '%s' "$IPAPI_JSON" | grep -Eo '"(org|company)"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 | sed -E 's/^"[^"]+"[[:space:]]*:[[:space:]]*"([^"]*)"$/\1/')"
      IP_TZ="$(printf '%s' "$IPAPI_JSON" | grep -Eo '"timezone"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 | sed -E 's/^"timezone"[[:space:]]*:[[:space:]]*"([^"]*)"$/\1/')"
      IS_DC="$(json_bool "$IPAPI_JSON" "is_datacenter")"
      IS_VPN="$(json_bool "$IPAPI_JSON" "is_vpn")"
      IS_PROXY="$(json_bool "$IPAPI_JSON" "is_proxy")"
      IS_TOR="$(json_bool "$IPAPI_JSON" "is_tor")"
      IS_ABUSER="$(json_bool "$IPAPI_JSON" "is_abuser")"
    fi
  else
    GEO_JSON="$(curl -fsSL --max-time 6 -A "$UA" "https://get.geojs.io/v1/ip/geo/${EXIT_IP}.json" 2>/dev/null || true)"
    if [ -n "$GEO_JSON" ]; then
      IP_ASN="$(json_num "$GEO_JSON" "asn")"
      IP_ORG="$(json_str "$GEO_JSON" "organization_name")"
      IP_TZ="$(json_str "$GEO_JSON" "timezone")"
    fi
  fi

  INFERRED_DC=0
  if [ -n "$IP_ASN" ] && is_dc_asn "$IP_ASN"; then
    INFERRED_DC=1
  elif [ -n "$IP_ASN" ] && is_residential_asn "$IP_ASN"; then
    INFERRED_DC=0
  elif [ -n "$IP_ORG" ] && is_dc_org "$IP_ORG"; then
    INFERRED_DC=1
  fi

  ASN_DESC="${IP_ASN:+AS${IP_ASN} }${IP_ORG:-未知}"
  if [ "$IS_TOR" = "true" ] || [ "$IS_ABUSER" = "true" ] || [ "$IS_PROXY" = "true" ]; then
    NET_SCORE=$((NET_SCORE + 30))
    print_row "FAIL" "$C_ERR" "IP 类型纯净度" "高危代理/滥用段 · ${ASN_DESC}"
    add_fix "当前出口命中公开代理或历史滥用标记，请更换干净独享节点。"
  elif [ "$IS_DC" = "true" ] || [ "$IS_VPN" = "true" ] || [ "$INFERRED_DC" = "1" ]; then
    NET_SCORE=$((NET_SCORE + 18))
    print_row "WARN" "$C_WARN" "IP 类型纯净度" "云机房 / VPN 段 · ${ASN_DESC}"
    add_fix "出口归属云机房段（${ASN_DESC}），建议固定单一节点减少跨区跳动；主力号优先住宅 ISP。"
  else
    print_row "PASS" "$C_OK" "IP 类型纯净度" "非机房/常规运营商段 · ${ASN_DESC}"
  fi
fi

# 4. DNS 泄露检测（edns.ip-api.com）
HEX32="$(rand_hex32)"
EDNS_JSON="$(curl -fsSL --max-time 6 -A "$UA" "https://${HEX32}.edns.ip-api.com/json" 2>/dev/null || true)"
DNS_IP="$(json_str "$EDNS_JSON" "ip")"
DNS_GEO="$(json_str "$EDNS_JSON" "geo")"

if [ -z "$DNS_IP" ]; then
  print_row "INFO" "$C_INFO" "DNS 泄露检测" "未获取到递归 DNS 回传（探测超时或被拦截）"
elif printf '%s' "$DNS_GEO" | grep -Eiq '^(China|Hong Kong|Macao|Macau|Russia|Belarus|Iran|North Korea|Syria|Cuba)[[:space:]]*-'; then
  NET_SCORE=$((NET_SCORE + 16))
  print_row "FAIL" "$C_ERR" "DNS 泄露检测" "检出受限地区 DNS：${DNS_IP}（${DNS_GEO}）"
  add_fix "终端 DNS 解析落入受限地区（${DNS_GEO}）。请在代理客户端开启 Fake-IP 与 Tun 模式，确保远程解析。"
else
  print_row "PASS" "$C_OK" "DNS 泄露检测" "海外解析器：${DNS_IP}${DNS_GEO:+（${DNS_GEO}）}"
fi

# 5. Anthropic 核心域名真实 HTTP 状态与延迟
API_FAIL=0
TARGET_SUMMARY=""
for host in "claude.ai" "api.anthropic.com" "www.anthropic.com"; do
  PROBE="$(curl -sS -o /dev/null --max-time 6 -A "$UA" -w '%{http_code} %{time_total}' "https://${host}/" 2>/dev/null || echo '000 0')"
  CODE="${PROBE%% *}"
  SECS="${PROBE##* }"
  MS="$(awk -v s="$SECS" 'BEGIN{printf "%d", s*1000}')"
  if [ "$CODE" = "000" ] || [ "$CODE" = "451" ]; then
    API_FAIL=$((API_FAIL + 1))
    TARGET_SUMMARY="${TARGET_SUMMARY}${host}(${CODE:-ERR}) "
  elif [ "$CODE" = "403" ] && [ "$host" = "claude.ai" ]; then
    # claude.ai 首页对裸 curl 常见 CF 403，记为可达但提示状态码
    TARGET_SUMMARY="${TARGET_SUMMARY}${host}(HTTP ${CODE}/${MS}ms) "
  else
    TARGET_SUMMARY="${TARGET_SUMMARY}${host}(HTTP ${CODE}/${MS}ms) "
  fi
done

if [ "$API_FAIL" -eq 3 ]; then
  NET_SCORE=$((NET_SCORE + 14))
  print_row "FAIL" "$C_ERR" "核心域名连通" "全部不可达：${TARGET_SUMMARY}"
  add_fix "补全 DOMAIN-SUFFIX,claude.ai 与 DOMAIN-SUFFIX,anthropic.com 分流规则并指向同一海外节点。"
elif [ "$API_FAIL" -gt 0 ]; then
  NET_SCORE=$((NET_SCORE + 7))
  print_row "WARN" "$C_WARN" "核心域名连通" "部分异常：${TARGET_SUMMARY}"
else
  print_row "PASS" "$C_OK" "核心域名连通" "${TARGET_SUMMARY}"
fi

# 6. 本机时区与语言环境
SYS_TZ=""
if [ -n "${TZ:-}" ]; then
  SYS_TZ="$TZ"
elif [ -L /etc/localtime ]; then
  SYS_TZ="$(readlink /etc/localtime 2>/dev/null | sed -E 's|.*zoneinfo/||')"
elif [ -f /etc/timezone ]; then
  SYS_TZ="$(tr -d ' \n' </etc/timezone)"
fi
SYS_OFFSET="$(date +%z 2>/dev/null || echo "")"

TZ_DIFF_HOURS=""
if [ -n "$IP_TZ" ] && command -v python3 >/dev/null 2>&1; then
  TZ_DIFF_HOURS="$(python3 - "$IP_TZ" <<'PY' 2>/dev/null || true
import sys
from datetime import datetime
from zoneinfo import ZoneInfo
try:
    now_local = datetime.now().astimezone()
    now_ip = datetime.now(ZoneInfo(sys.argv[1]))
    diff = abs((now_local.utcoffset().total_seconds() - now_ip.utcoffset().total_seconds()) / 3600.0)
    print(f"{diff:.1f}".rstrip("0").rstrip("."))
except Exception:
    pass
PY
)"
fi

case "$SYS_TZ" in
  Asia/Shanghai|Asia/Chongqing|Asia/Harbin|Asia/Urumqi|Asia/Hong_Kong|Asia/Macau|Asia/Macao|PRC)
    LOCAL_SCORE=$((LOCAL_SCORE + 50))
    print_row "FAIL" "$C_ERR" "本机系统时区" "${SYS_TZ} (${SYS_OFFSET})${IP_TZ:+ ↔ 出口 ${IP_TZ}}（受限地区时区）"
    add_fix "系统时区为 ${SYS_TZ}，运行 Claude Code 时可按需对齐时区（例如 TZ=${IP_TZ:-America/Los_Angeles} claude）。"
    ;;
  *)
    if [ -n "$TZ_DIFF_HOURS" ] && awk -v d="$TZ_DIFF_HOURS" 'BEGIN{exit !(d > 3)}'; then
      LOCAL_SCORE=$((LOCAL_SCORE + 30))
      print_row "FAIL" "$C_ERR" "本机系统时区" "${SYS_TZ:-未知} (${SYS_OFFSET}) ↔ 出口 ${IP_TZ}（相差 ${TZ_DIFF_HOURS} 小时，跨区错位）"
      add_fix "本机时区与出口时区（${IP_TZ}）相差 ${TZ_DIFF_HOURS} 小时；运行 Claude Code 可加 TZ=${IP_TZ} 或改用同区节点。"
    elif [ -n "$TZ_DIFF_HOURS" ] && awk -v d="$TZ_DIFF_HOURS" 'BEGIN{exit !(d > 0)}'; then
      LOCAL_SCORE=$((LOCAL_SCORE + 10))
      print_row "WARN" "$C_WARN" "本机系统时区" "${SYS_TZ:-未知} (${SYS_OFFSET}) ↔ 出口 ${IP_TZ}（相差 ${TZ_DIFF_HOURS} 小时）"
    else
      print_row "PASS" "$C_OK" "本机系统时区" "${SYS_TZ:-未知} (${SYS_OFFSET})${IP_TZ:+ ↔ 出口 ${IP_TZ}}"
    fi
    ;;
esac

SYS_LANG="${LC_ALL:-${LANG:-}}"
if printf '%s' "$SYS_LANG" | grep -Eiq '^zh_CN'; then
  LOCAL_SCORE=$((LOCAL_SCORE + 30))
  print_row "WARN" "$C_WARN" "终端语言环境" "${SYS_LANG}（携带 zh_CN 标识）"
  add_fix "可在运行 Claude Code 时临时使用英文区域：LANG=en_US.UTF-8 claude。"
else
  print_row "PASS" "$C_OK" "终端语言环境" "${SYS_LANG:-未声明}"
fi

# 汇总结果
[ "$NET_SCORE" -gt 100 ] && NET_SCORE=100
[ "$LOCAL_SCORE" -gt 100 ] && LOCAL_SCORE=100

printf "${C_DIM}────────────────────────────────────────────────────────────${C_RESET}\n"
if [ "$NET_SCORE" -ge 50 ]; then
  NET_LVL="高风险"; NET_COL="$C_ERR"
elif [ "$NET_SCORE" -ge 18 ]; then
  NET_LVL="中风险"; NET_COL="$C_WARN"
else
  NET_LVL="低风险"; NET_COL="$C_OK"
fi

if [ "$LOCAL_SCORE" -ge 50 ]; then
  LOC_LVL="高风险"; LOC_COL="$C_ERR"
elif [ "$LOCAL_SCORE" -ge 20 ]; then
  LOC_LVL="中风险"; LOC_COL="$C_WARN"
else
  LOC_LVL="低风险"; LOC_COL="$C_OK"
fi

printf "  网络链路风险：${NET_COL}${C_BOLD}%d / 100（%s）${C_RESET}   |   本机环境风险：${LOC_COL}${C_BOLD}%d / 100（%s）${C_RESET}\n" \
  "$NET_SCORE" "$NET_LVL" "$LOCAL_SCORE" "$LOC_LVL"

if [ "${#FIXES[@]}" -gt 0 ]; then
  printf "\n${C_BOLD}建议优先处理：${C_RESET}\n"
  i=1
  for f in "${FIXES[@]}"; do
    printf "  %d. %s\n" "$i" "$f"
    i=$((i + 1))
  done
else
  printf "\n${C_OK}当前终端出口与本地环境干净，未命中高危项。${C_RESET}\n"
fi
printf "\n"

if [ "$STRICT_MODE" -eq 1 ] && { [ "$NET_SCORE" -ge 50 ] || [ "$LOCAL_SCORE" -ge 50 ]; }; then
  exit 2
fi
exit 0
