/**
 * Claude 环境检测结果分享图生成器（纯 Canvas 2D，零第三方依赖）。
 *
 * 尺寸：1200 × 630（1.91:1，适配 X / Twitter、Telegram、小红书卡片比例），
 * 以 2x DPR（2400 × 1260）导出 PNG，默认对出口 IP 做后两段脱敏，方便安全分享。
 */

import { countryLabel, maskIp, maskIpsInText } from "./env-check.js";

const W = 1200;
const H = 630;
const DPR = 2;

const FONT_SANS = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", sans-serif';
const FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

const TONE = {
  ok: { fg: "#34d399", bg: "rgba(16, 185, 129, 0.14)", border: "rgba(52, 211, 153, 0.32)" },
  warn: { fg: "#fbbf24", bg: "rgba(245, 158, 11, 0.14)", border: "rgba(251, 191, 36, 0.34)" },
  err: { fg: "#fb7185", bg: "rgba(244, 63, 94, 0.16)", border: "rgba(251, 113, 133, 0.38)" },
  info: { fg: "#a8a29e", bg: "rgba(255, 255, 255, 0.06)", border: "rgba(255, 255, 255, 0.12)" },
};

function toneOfLevel(level) {
  if (level === "high") return TONE.err;
  if (level === "medium") return TONE.warn;
  return TONE.ok;
}

function levelText(level) {
  if (level === "high") return "高风险";
  if (level === "medium") return "中风险";
  return "低风险";
}

function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function truncate(ctx, text, maxW) {
  const raw = String(text ?? "");
  if (!raw || ctx.measureText(raw).width <= maxW) return raw;
  let lo = 0;
  let hi = raw.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${raw.slice(0, mid)}…`).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return `${raw.slice(0, Math.max(1, lo))}…`;
}

function wrapLines(ctx, text, maxW, maxLines = 2) {
  const raw = String(text ?? "");
  if (!raw) return [];
  const lines = [];
  let current = "";
  for (const ch of raw) {
    const next = current + ch;
    if (ctx.measureText(next).width > maxW && current) {
      lines.push(current);
      current = ch;
      if (lines.length === maxLines - 1) break;
    } else {
      current = next;
    }
  }
  if (current) {
    const remaining = raw.slice(lines.join("").length);
    lines.push(lines.length === maxLines - 1 ? truncate(ctx, remaining, maxW) : current);
  }
  return lines.slice(0, maxLines);
}

function drawPill(ctx, x, y, text, tone, { fontSize = 14, padX = 12, height = 28 } = {}) {
  ctx.font = `600 ${fontSize}px ${FONT_SANS}`;
  const tw = ctx.measureText(text).width;
  const pw = tw + padX * 2;
  roundRect(ctx, x, y, pw, height, height / 2);
  ctx.fillStyle = tone.bg;
  ctx.fill();
  ctx.strokeStyle = tone.border;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = tone.fg;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + padX, y + height / 2 + 0.5);
  return pw;
}

function drawProgressBar(ctx, x, y, w, h, score, tone, marks) {
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  ctx.fill();

  const fillW = Math.max(h, Math.round((Math.min(100, Math.max(0, score)) / 100) * w));
  roundRect(ctx, x, y, fillW, h, h / 2);
  ctx.fillStyle = tone.fg;
  ctx.fill();

  for (const mark of marks) {
    const mx = x + Math.round((mark / 100) * w);
    ctx.fillStyle = "rgba(255, 255, 255, 0.38)";
    ctx.fillRect(mx, y - 3, 1.5, h + 6);
  }

  ctx.font = `500 12px ${FONT_MONO}`;
  ctx.fillStyle = "#78716c";
  ctx.textBaseline = "top";
  ctx.fillText("0", x, y + h + 8);
  for (const mark of marks) {
    const mx = x + Math.round((mark / 100) * w);
    const label = String(mark);
    ctx.fillText(label, mx - ctx.measureText(label).width / 2, y + h + 8);
  }
  const endLabel = "100";
  ctx.fillText(endLabel, x + w - ctx.measureText(endLabel).width, y + h + 8);
}

function drawMetaRow(ctx, x, y, w, label, value, { mono = false } = {}) {
  ctx.font = `500 14px ${FONT_SANS}`;
  ctx.fillStyle = "#8f8882";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y);

  ctx.font = `${mono ? "500" : "600"} 15px ${mono ? FONT_MONO : FONT_SANS}`;
  ctx.fillStyle = "#e7e5e4";
  const labelReserve = 96;
  const valText = truncate(ctx, value, w - labelReserve);
  const vw = ctx.measureText(valText).width;
  ctx.fillText(valText, x + w - vw, y);
}

export function renderEnvCheckCard(
  result,
  {
    checkedAt = "",
    brandLabel = "ClaudeCheck",
    siteUrl = "github.com/gm365/ClaudeCheck",
    title = "Claude 封号风险与 IP 纯净度检测",
  } = {},
) {
  const canvas = document.createElement("canvas");
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.scale(DPR, DPR);

  // 1. 背景与顶部柔光
  ctx.fillStyle = "#11100f";
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W * 0.85, 0, 20, W * 0.85, 0, 560);
  glow.addColorStop(0, "rgba(15, 107, 92, 0.28)");
  glow.addColorStop(1, "rgba(15, 107, 92, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // 2. 顶部标题区
  const padX = 48;
  ctx.font = `700 30px ${FONT_SANS}`;
  ctx.fillStyle = "#fafaf9";
  ctx.textBaseline = "top";
  ctx.fillText(title, padX, 38);

  const subParts = [brandLabel];
  if (result?.exitModeLabel) subParts.push(`出口来源：${result.exitModeLabel}`);
  if (checkedAt) subParts.push(`检测时间 ${checkedAt}`);
  ctx.font = `500 15px ${FONT_SANS}`;
  ctx.fillStyle = "#a8a29e";
  ctx.fillText(subParts.join("  ·  "), padX, 80);

  // 右上角脱敏标识胶囊
  const badgeText = "IP 已自动脱敏";
  ctx.font = `600 13px ${FONT_SANS}`;
  const badgeW = ctx.measureText(badgeText).width + 24;
  drawPill(
    ctx,
    W - padX - badgeW,
    46,
    badgeText,
    { fg: "#34b39c", bg: "rgba(52, 179, 156, 0.12)", border: "rgba(52, 179, 156, 0.3)" },
    { fontSize: 13, padX: 12, height: 28 },
  );

  // 3. 中部双风险卡片
  const cardY = 124;
  const cardH = 414;
  const gap = 24;
  const cardW = (W - padX * 2 - gap) / 2;

  const net = result?.network || { riskScore: 0, riskLevel: "low", ipTypeLabel: "未知", tags: [], summary: "" };
  const loc = result?.local || { riskScore: 0, riskLevel: "low", items: [], summary: "" };
  const netTone = toneOfLevel(net.riskLevel);
  const locTone = toneOfLevel(loc.riskLevel);

  // 左卡：网络与代理风险
  {
    const cx = padX;
    roundRect(ctx, cx, cardY, cardW, cardH, 16);
    ctx.fillStyle = "#191716";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.09)";
    ctx.lineWidth = 1;
    ctx.stroke();

    const innerX = cx + 28;
    const innerW = cardW - 56;

    ctx.font = `600 14px ${FONT_SANS}`;
    ctx.fillStyle = "#a8a29e";
    ctx.textBaseline = "top";
    ctx.fillText("网络与代理风险 · 越低越安全", innerX, cardY + 24);

    if (net.ipTypeLabel) {
      ctx.font = `600 13px ${FONT_SANS}`;
      const lw = ctx.measureText(net.ipTypeLabel).width;
      ctx.fillStyle = "#d6d3d1";
      ctx.fillText(net.ipTypeLabel, innerX + innerW - lw, cardY + 24);
    }

    // 分数与等级
    const scoreStr = String(net.riskScore ?? 0);
    ctx.font = `700 58px ${FONT_MONO}`;
    ctx.fillStyle = netTone.fg;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(scoreStr, innerX, cardY + 114);
    const sw = ctx.measureText(scoreStr).width;

    ctx.font = `500 20px ${FONT_MONO}`;
    ctx.fillStyle = "#78716c";
    ctx.fillText("/ 100", innerX + sw + 10, cardY + 110);

    drawPill(ctx, innerX + sw + 84, cardY + 86, levelText(net.riskLevel), netTone, {
      fontSize: 14,
      padX: 14,
      height: 30,
    });

    // 进度条
    drawProgressBar(ctx, innerX, cardY + 136, innerW, 10, net.riskScore ?? 0, netTone, [18, 50]);

    // 元信息分隔线
    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
    ctx.fillRect(innerX, cardY + 184, innerW, 1);

    const activeNet = result?.activeNet;
    const regionStr = activeNet?.country
      ? `${countryLabel(activeNet.country, activeNet.countryName)}${activeNet.city ? ` · ${activeNet.city}` : ""}`
      : "未知";
    const maskedIp = activeNet?.ip ? maskIp(activeNet.ip) : "未获取到";
    const asnStr =
      activeNet?.asn || activeNet?.org
        ? `${activeNet.asn ? `AS${activeNet.asn}` : ""}${activeNet.asn && activeNet.org ? " · " : ""}${activeNet.org || ""}`
        : "未知";

    drawMetaRow(ctx, innerX, cardY + 214, innerW, "出口地区", regionStr);
    drawMetaRow(ctx, innerX, cardY + 250, innerW, "出口 IP", maskedIp, { mono: true });
    drawMetaRow(ctx, innerX, cardY + 286, innerW, "网络 / ASN", asnStr, { mono: true });

    // 状态标签行
    let tx = innerX;
    const ty = cardY + 324;
    const tags = (net.tags || []).slice(0, 4);
    for (const tag of tags) {
      const tTone = TONE[tag.tone] || TONE.info;
      ctx.font = `600 13px ${FONT_SANS}`;
      const estW = ctx.measureText(tag.label).width + 22;
      if (tx + estW > innerX + innerW) break;
      const used = drawPill(ctx, tx, ty, tag.label, tTone, { fontSize: 13, padX: 11, height: 26 });
      tx += used + 8;
    }

    // 底部摘要
    ctx.font = `400 13px ${FONT_SANS}`;
    ctx.fillStyle = "#9a938c";
    ctx.textBaseline = "top";
    const netSummary = truncate(ctx, maskIpsInText(net.summary || ""), innerW);
    ctx.fillText(netSummary, innerX, cardY + 368);
  }

  // 右卡：本地指纹风险
  {
    const cx = padX + cardW + gap;
    roundRect(ctx, cx, cardY, cardW, cardH, 16);
    ctx.fillStyle = "#191716";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.09)";
    ctx.lineWidth = 1;
    ctx.stroke();

    const innerX = cx + 28;
    const innerW = cardW - 56;

    ctx.font = `600 14px ${FONT_SANS}`;
    ctx.fillStyle = "#a8a29e";
    ctx.textBaseline = "top";
    ctx.fillText("本地指纹风险 · 越低越安全", innerX, cardY + 24);

    const localHits = (loc.items || []).filter((it) => it.score > 0).length;
    const totalLocal = (loc.items || []).length || 8;
    const hitBadge = `${localHits} / ${totalLocal} 项命中`;
    ctx.font = `600 13px ${FONT_SANS}`;
    const hw = ctx.measureText(hitBadge).width;
    ctx.fillStyle = "#d6d3d1";
    ctx.fillText(hitBadge, innerX + innerW - hw, cardY + 24);

    const scoreStr = String(loc.riskScore ?? 0);
    ctx.font = `700 58px ${FONT_MONO}`;
    ctx.fillStyle = locTone.fg;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(scoreStr, innerX, cardY + 114);
    const sw = ctx.measureText(scoreStr).width;

    ctx.font = `500 20px ${FONT_MONO}`;
    ctx.fillStyle = "#78716c";
    ctx.fillText("/ 100", innerX + sw + 10, cardY + 110);

    drawPill(ctx, innerX + sw + 84, cardY + 86, levelText(loc.riskLevel), locTone, {
      fontSize: 14,
      padX: 14,
      height: 30,
    });

    drawProgressBar(ctx, innerX, cardY + 136, innerW, 10, loc.riskScore ?? 0, locTone, [20, 50]);

    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
    ctx.fillRect(innerX, cardY + 184, innerW, 1);

    const tzVal = loc.items?.[0]?.value || "未知";
    const langVal = loc.items?.[1]?.value || "未知";
    const hitVal = localHits > 0 ? `${localHits} / ${totalLocal} 项命中风险` : `0 / ${totalLocal} 项（全部通过）`;

    drawMetaRow(ctx, innerX, cardY + 214, innerW, "时区对照", tzVal, { mono: true });
    drawMetaRow(ctx, innerX, cardY + 250, innerW, "浏览器语言", langVal, { mono: true });
    drawMetaRow(ctx, innerX, cardY + 286, innerW, "指纹命中", hitVal);

    // 底部说明（最多 2 行）
    ctx.font = `400 14px ${FONT_SANS}`;
    ctx.fillStyle = "#a8a29e";
    ctx.textBaseline = "top";
    const lines = wrapLines(ctx, loc.summary || "", innerW, 2);
    lines.forEach((line, i) => {
      ctx.fillText(line, innerX, cardY + 332 + i * 24);
    });
  }

  // 4. 底部引流条
  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  ctx.fillRect(padX, 558, W - padX * 2, 1);

  ctx.font = `500 14px ${FONT_SANS}`;
  ctx.fillStyle = "#8f8882";
  ctx.textBaseline = "middle";
  ctx.fillText("本地检测 · 零日志留存 · 含出口 IP、机房库、WebRTC、DNS 泄露与 8 项本地指纹", padX, 592);

  const ctaText = `免费自检 → ${siteUrl}`;
  ctx.font = `600 16px ${FONT_MONO}`;
  ctx.fillStyle = "#34b39c";
  const cw = ctx.measureText(ctaText).width;
  ctx.fillText(ctaText, W - padX - cw, 592);

  return canvas;
}

export async function downloadEnvCheckCard(result, opts = {}) {
  const canvas = renderEnvCheckCard(result, opts);
  if (!canvas) return false;

  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
  ].join("");
  const filename = `claude-check-${stamp}.png`;

  const triggerDownload = (href, revoke = false) => {
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (revoke) setTimeout(() => URL.revokeObjectURL(href), 1500);
  };

  if (typeof canvas.toBlob === "function") {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          try {
            triggerDownload(canvas.toDataURL("image/png"), false);
            resolve(true);
          } catch {
            resolve(false);
          }
          return;
        }
        triggerDownload(URL.createObjectURL(blob), true);
        resolve(true);
      }, "image/png");
    });
  }

  triggerDownload(canvas.toDataURL("image/png"), false);
  return true;
}
