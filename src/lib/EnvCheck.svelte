<script>
  import { onMount, tick } from "svelte";
  import {
    Activity,
    Check,
    ChevronDown,
    CircleCheck,
    Clock,
    Compass,
    Copy,
    ExternalLink,
    Globe,
    Languages,
    Laptop,
    ListChecks,
    Lock,
    Network,
    Play,
    RefreshCw,
    Server,
    ShieldCheck,
    Smartphone,
    Sparkles,
    Split,
    Terminal,
    Timer,
    Type,
    Wifi,
  } from "lucide-svelte";
  import { AI_TARGETS } from "./ai-targets.js";
  import {
    CLAUDE_TARGETS,
    buildEnvCheckAiPrompt,
    collectLocalSignals,
    countryLabel,
    envCheckAskPlan,
    evaluateCheck,
    lookupIpMetadata,
    parseCloudflareTrace,
    probeClaudeEdge,
    probeClaudeTargets,
    probeDnsLeak,
    probeOverseasIp,
    probeSiteEdge,
    probeWebRTC,
  } from "./env-check.js";

  const ITEM_ICONS = {
    overseas_region: Globe,
    ip_purity: ShieldCheck,
    webrtc_leak: Wifi,
    dns_leak: Server,
    claude_reachability: Activity,
    split_routing: Split,
    system_timezone: Clock,
    browser_language: Languages,
    cn_vendor_fonts: Type,
    cn_browser: Compass,
    cn_device: Smartphone,
    intl_locale: Globe,
    common_cn_fonts: Type,
    timezone_offset: Timer,
  };

  const CURL_CMD = "curl -s https://claude.ai/cdn-cgi/trace";
  const CLI_CHECK_CMD = "curl -fsSL https://raw.githubusercontent.com/gm365/ClaudeCheck/main/scripts/check.sh | bash";

  const INITIAL_STATE = evaluateCheck({
    claude: CLAUDE_TARGETS.map((t) => ({ ...t, ok: true, rttMs: null })),
  });

  // ready 在客户端 hydrate 完成后置 true，避免静态预渲染首屏出现点了没反应的空按钮
  let ready = $state(false);
  let scanning = $state(false);
  let scannedOnce = $state(false);
  let stageLeaving = $state(false);
  let scanStageText = $state("");
  let scanCount = $state(0);
  let checkedAt = $state("");
  let copiedCurl = $state(false);
  let copiedCli = $state(false);
  let result = $state(INITIAL_STATE);

  let lastSignals = $state({ edge: null, claudeEdge: null, overseas: null, webrtc: null, dns: null, claude: [], local: null });
  let traceInput = $state("");
  let traceError = $state("");
  let traceLoading = $state(false);
  let traceOpen = $state(false);
  let claudeTrace = $state(null);

  let aiOpen = $state(false);
  let aiDone = $state("");
  let aiRoot = $state(null);
  let aiBtn = $state(null);
  let aiList = $state(null);
  const uid = $props.id();
  const aiMenuId = `${uid}-ai-menu`;

  // 风险阈值刻度：与 env-check.js 中 riskLevel 的分档保持一致（网络 18/50，本地 20/50）
  const NET_MARKS = [18, 50];
  const LOCAL_MARKS = [20, 50];

  const settled = $derived(scannedOnce && !scanning);
  // 存在任一风险分时，「问 AI 加固」升为主操作，「重新检测」退为次级按钮
  const hasRisk = $derived(settled && (result.network.riskScore > 0 || result.local.riskScore > 0));
  const localHits = $derived(result.local.items.filter((x) => x.score > 0).length);

  function toneOf(item) {
    return settled ? item.status : "info";
  }

  async function openAiFromPlaybook(e) {
    // 阻止冒泡，避免 document 级「点外部关闭」立刻把菜单收起
    e.stopPropagation();
    // 先展开并聚焦首项（focus 会把菜单滚入视口），再把顶部按钮平滑居中
    if (!aiOpen) await toggleAi();
    aiBtn?.scrollIntoView({ block: "center" });
  }

  function mergeIpMeta(node, meta) {
    if (!meta) return node;
    return {
      ...node,
      country: node.country || meta.country,
      countryName: meta.countryName || node.countryName,
      city: node.city || meta.city,
      timezone: node.timezone || meta.timezone,
      asn: node.asn ?? meta.asn,
      org: node.org || meta.org,
      asnType: meta.asnType || node.asnType,
      isDatacenter: meta.isDatacenter,
      isVpn: meta.isVpn,
      isProxy: meta.isProxy,
      isTor: meta.isTor,
      isAbuser: meta.isAbuser,
    };
  }

  async function runScan() {
    if (scanning) return;
    const firstRun = !scannedOnce;
    scanning = true;
    aiOpen = false;
    aiDone = "";
    const started = performance.now();
    let stageTimer = null;
    if (firstRun) {
      scanStageText = "正在识别出口 IP 与节点…";
      stageTimer = setTimeout(() => {
        if (scanning && !scannedOnce) {
          scanStageText = "正在核对时区与本机指纹…";
        }
      }, 520);
    }
    try {
      const [rawEdge, rawClaudeEdge, overseas, webrtc, dns, claude, local] = await Promise.all([
        probeSiteEdge(),
        probeClaudeEdge(),
        probeOverseasIp(),
        probeWebRTC(),
        probeDnsLeak(),
        probeClaudeTargets(),
        collectLocalSignals(),
      ]);

      let edge = rawEdge;
      let claudeEdge = rawClaudeEdge;
      const needMeta =
        rawClaudeEdge?.ok && rawClaudeEdge.ip && rawClaudeEdge.ip !== overseas?.ip
          ? rawClaudeEdge
          : rawEdge?.ok && rawEdge.isClaudeKeywordHit && rawEdge.ip && rawEdge.ip !== overseas?.ip
            ? rawEdge
            : null;
      if (needMeta) {
        if (firstRun) scanStageText = "正在核对节点归属与风险…";
        const meta = await lookupIpMetadata(needMeta.ip, 3200);
        if (meta) {
          if (needMeta === rawClaudeEdge) claudeEdge = mergeIpMeta(rawClaudeEdge, meta);
          else edge = mergeIpMeta(rawEdge, meta);
        }
      }

      if (firstRun) scanStageText = "正在生成检测报告…";
      const minWait = firstRun ? 520 : 360;
      const elapsed = performance.now() - started;
      if (elapsed < minWait) {
        await new Promise((r) => setTimeout(r, minWait - elapsed));
      }
      lastSignals = { edge, claudeEdge, overseas, webrtc, dns, claude, local };
      result = evaluateCheck({ ...lastSignals, claudeTrace });
      scanCount += 1;
      checkedAt = new Date().toLocaleTimeString("zh-CN", { hour12: false });

      if (firstRun) {
        const reduceMotion =
          typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (!reduceMotion) {
          stageLeaving = true;
          await new Promise((r) => setTimeout(r, 180));
        }
        scannedOnce = true;
        stageLeaving = false;
      } else {
        scannedOnce = true;
      }
    } finally {
      if (stageTimer) clearTimeout(stageTimer);
      stageLeaving = false;
      scanning = false;
    }
  }

  async function applyClaudeTrace() {
    traceError = "";
    const parsed = parseCloudflareTrace(traceInput);
    if (!parsed) {
      traceError = "未识别到 ip= 或 loc= 字段，请粘贴完整的 claude.ai/cdn-cgi/trace 内容。";
      return;
    }
    traceLoading = true;
    try {
      const meta = parsed.ip ? await lookupIpMetadata(parsed.ip) : null;
      const merged = meta
        ? {
            ...parsed,
            country: parsed.country || meta.country,
            countryName: meta.countryName || parsed.countryName,
            city: meta.city || parsed.city,
            timezone: meta.timezone || parsed.timezone,
            asn: meta.asn ?? parsed.asn,
            org: meta.org || parsed.org,
            asnType: meta.asnType || parsed.asnType,
            isDatacenter: meta.isDatacenter,
            isVpn: meta.isVpn,
            isProxy: meta.isProxy,
            isTor: meta.isTor,
            isAbuser: meta.isAbuser,
          }
        : parsed;
      claudeTrace = merged;
      result = evaluateCheck({ ...lastSignals, claudeTrace: merged });
      checkedAt = new Date().toLocaleTimeString("zh-CN", { hour12: false });
      scannedOnce = true;
    } finally {
      traceLoading = false;
    }
  }

  function clearClaudeTrace() {
    claudeTrace = null;
    traceInput = "";
    traceError = "";
    if (scannedOnce) {
      result = evaluateCheck({ ...lastSignals, claudeTrace: null });
    }
  }

  function riskLabel(level) {
    if (level === "high") return "高风险";
    if (level === "medium") return "中风险";
    return "低风险";
  }

  function riskTone(level) {
    if (level === "high") return "err";
    if (level === "medium") return "warn";
    return "ok";
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {}
      ta.remove();
      return ok;
    }
  }

  async function copyCurl() {
    const ok = await copyText(CURL_CMD);
    if (ok) {
      copiedCurl = true;
      setTimeout(() => {
        copiedCurl = false;
      }, 2000);
    }
  }

  async function copyCli() {
    const ok = await copyText(CLI_CHECK_CMD);
    if (ok) {
      copiedCli = true;
      setTimeout(() => {
        copiedCli = false;
      }, 2000);
    }
  }

  function runAskAi(target) {
    if (!scannedOnce) return;
    const pageUrl = typeof location !== "undefined" ? `${location.origin}${location.pathname}` : "";
    const prompt = buildEnvCheckAiPrompt(result, { url: pageUrl });
    const plan = target ? envCheckAskPlan(target, result, { url: pageUrl }) : null;
    if (plan) window.open(plan.url, "_blank", "noopener,noreferrer");
    copyText(prompt).then((ok) => {
      aiDone = !ok
        ? "复制失败，请换个浏览器重试"
        : !target
          ? "提示词已复制，粘贴给任意 AI 即可"
          : plan.filled
            ? `已打开 ${target.label}；如未自动填入，直接粘贴即可`
            : `提示词已复制，在 ${target.label} 中粘贴发送`;
    });
  }

  const aiItems = () => [...(aiList?.querySelectorAll('[role="menuitem"]') || [])];
  async function toggleAi(last = false) {
    if (!scannedOnce || scanning) return;
    aiOpen = !aiOpen;
    aiDone = "";
    if (aiOpen) {
      await tick();
      aiItems().at(last ? -1 : 0)?.focus();
    }
  }

  function onAiMenuKey(e) {
    const all = aiItems();
    const i = all.indexOf(document.activeElement);
    const go = (k) => {
      e.preventDefault();
      all[(k + all.length) % all.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i < 0 ? -1 : i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(-1);
    else if (e.key === "Tab") aiOpen = false;
  }

  onMount(() => {
    ready = true;
    const close = (e) => {
      if (aiOpen && aiRoot && !aiRoot.contains(e.target)) aiOpen = false;
    };
    const esc = (e) => {
      if (e.key !== "Escape" || !aiOpen) return;
      const inside = aiRoot?.contains(document.activeElement);
      aiOpen = false;
      if (inside) aiBtn?.focus();
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", esc);
    };
  });
</script>

<div class="check-page" class:is-idle={!scannedOnce}>
  {#if !scannedOnce}
    <section
      class="check-stage"
      class:is-scanning={scanning}
      class:is-leaving={stageLeaving}
      aria-label="开始环境检测"
    >
      <div class="scan-radar" aria-hidden="true">
        <span class="scan-sweep"></span>
        {#if scanning}
          <span class="scan-pulse"></span>
        {/if}
      </div>

      <div class="stage-body">
        <h1 class="check-title">Claude 封号风险与 IP 纯净度检测</h1>
        <p class="check-lead">一键排查出口 IP 机房属性、DNS / WebRTC 泄露、时区差与 8 项本机指纹</p>

        <div class="ready-cta-wrap">
          <button
            type="button"
            class="check-btn-cta is-hero"
            class:is-busy={scanning}
            onclick={runScan}
            disabled={!ready || scanning}
          >
            {#if !ready}
              <RefreshCw size={17} class="is-spin" aria-hidden="true" />
              <span>准备中…</span>
            {:else if scanning}
              <RefreshCw size={17} class="is-spin" aria-hidden="true" />
              <span>正在检测…</span>
            {:else}
              <Play size={17} aria-hidden="true" />
              <span>开始检测</span>
            {/if}
          </button>
        </div>

        <p class="ready-meta" aria-live="polite">
          {#if scanning}
            <Activity size={13} aria-hidden="true" />
            <span>{scanStageText || "正在扫描网络与本地环境…"}</span>
          {:else}
            <ShieldCheck size={13} aria-hidden="true" />
            <span>约 2 秒完成 · 仅在本地运行</span>
          {/if}
        </p>

        <ul class="stage-scope" aria-label="检测范围">
          <li><Network size={13} aria-hidden="true" />出口 IP 与机房</li>
          <li aria-hidden="true" class="stage-dot">·</li>
          <li><Laptop size={13} aria-hidden="true" />WebRTC 与 DNS 泄露</li>
          <li aria-hidden="true" class="stage-dot">·</li>
          <li><Sparkles size={13} aria-hidden="true" />时区与本机指纹</li>
        </ul>
      </div>
    </section>
  {:else}
    <header class="check-hero reveal" style:--i="0">
      <div class="check-hero-main">
        <h1 class="check-title">Claude 封号风险与 IP 纯净度检测</h1>
        <p class="check-lead">一键排查出口 IP 机房属性、DNS / WebRTC 泄露、时区差与 8 项本机指纹</p>
      </div>

      <div class="check-hero-side">
        <div class="check-actions">
          <button
            type="button"
            class="check-btn-cta"
            class:is-quiet={hasRisk}
            onclick={runScan}
            disabled={!ready || scanning}
          >
            {#if scanning}
              <RefreshCw size={16} class="is-spin" aria-hidden="true" />
              <span>正在检测…</span>
            {:else}
              <RefreshCw size={16} aria-hidden="true" />
              <span>重新检测</span>
            {/if}
          </button>

          <div class="check-ask" bind:this={aiRoot}>
            <button
              bind:this={aiBtn}
              type="button"
              class="check-ask-btn"
              class:is-lead={hasRisk}
              disabled={scanning}
              title="把命中项整理成提示词，请 AI 帮你制定系统性加固步骤"
              aria-expanded={aiOpen}
              aria-haspopup="menu"
              aria-controls={aiOpen ? aiMenuId : undefined}
              onclick={() => toggleAi()}
              onkeydown={(e) => {
                if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !aiOpen) {
                  e.preventDefault();
                  toggleAi(e.key === "ArrowUp");
                }
              }}
            >
              <Sparkles size={15} aria-hidden="true" />
              <span>问 AI 加固</span>
            </button>

            {#if aiOpen}
              <div
                id={aiMenuId}
                class="check-ask-menu"
                role="menu"
                tabindex="-1"
                aria-label="交给 AI 制定加固方案"
                bind:this={aiList}
                onkeydown={onAiMenuKey}
              >
                <p class="check-ask-note">把本次命中的网络与本地风险项整理成提示词，请 AI 给出针对性加固方案。</p>
                <button type="button" class="check-ask-item" role="menuitem" onclick={() => runAskAi(null)}>
                  <Copy size={14} aria-hidden="true" />
                  <span>复制加固提示词</span>
                </button>
                {#each AI_TARGETS as target (target.id)}
                  <button type="button" class="check-ask-item" role="menuitem" onclick={() => runAskAi(target)}>
                    <ExternalLink size={14} aria-hidden="true" />
                    <span>{target.label}</span>
                    <span class="check-ask-sub">{target.fill ? "自动填入" : "复制后打开"}</span>
                  </button>
                {/each}
                {#if aiDone}
                  <p class="check-ask-done" role="status"><Check size={13} aria-hidden="true" />{aiDone}</p>
                {/if}
                <p class="check-ask-foot">提示词仅包含本次检测摘要，发送前可按需编辑。</p>
              </div>
            {/if}
          </div>
        </div>

        <p class="check-privacy">
          <Lock size={13} aria-hidden="true" />
          <span>本地运算，结果仅当前页面可见</span>
        </p>
      </div>
    </header>

    <section class="dual-board reveal" style:--i="1" aria-live="polite" aria-label="双维度独立风险评分">
      <article class="metric-panel" data-tone={settled ? riskTone(result.network.riskLevel) : "info"}>
        <div class="panel-top">
          <span class="panel-eyebrow"><Network size={14} aria-hidden="true" />网络与代理风险 · 越低越安全</span>
          {#if settled}
            <span class="panel-meta">{result.network.ipTypeLabel}</span>
          {/if}
        </div>

        <div class="score-num-row">
          <strong class="score-num" data-tone={settled ? riskTone(result.network.riskLevel) : "info"}>
            {scanning ? "…" : result.network.riskScore}
          </strong>
          <span class="score-max">/ 100</span>
          <span class="score-side">
            {#if scanning}
              <span class="score-pill" data-tone="info">正在检测…</span>
            {:else}
              <span class="score-pill" data-tone={riskTone(result.network.riskLevel)}>{riskLabel(result.network.riskLevel)}</span>
              <span class="score-source">{result.exitModeLabel}</span>
            {/if}
          </span>
        </div>

        <div
          class="score-bar"
          role="progressbar"
          aria-valuenow={settled ? result.network.riskScore : 0}
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div
            class="score-bar-fill"
            data-tone={settled ? riskTone(result.network.riskLevel) : "info"}
            style:width={`${settled ? Math.max(3, result.network.riskScore) : 0}%`}
          ></div>
          {#each NET_MARKS as mark (mark)}
            <span class="score-mark" style:left={`${mark}%`} aria-hidden="true"></span>
          {/each}
        </div>
        <div class="score-scale" aria-hidden="true">
          <span>0</span>
          {#each NET_MARKS as mark (mark)}
            <span style:left={`${mark}%`}>{mark}</span>
          {/each}
          <span>100</span>
        </div>

        <dl class="ip-meta-grid">
          <div>
            <dt>出口 IP</dt>
            <dd class="is-mono">{scanning ? "检测中…" : result.activeNet?.ip || "未获取到"}</dd>
          </div>
          <div>
            <dt>位置</dt>
            <dd>
              {#if scanning}
                检测中…
              {:else if result.activeNet?.country}
                {countryLabel(result.activeNet.country, result.activeNet.countryName)}{result.activeNet.city ? ` · ${result.activeNet.city}` : ""}
              {:else}
                未知
              {/if}
            </dd>
          </div>
          <div>
            <dt>网络 / ASN</dt>
            <dd class="is-mono">
              {#if scanning}
                检测中…
              {:else if result.activeNet?.asn || result.activeNet?.org}
                {result.activeNet.asn ? `AS${result.activeNet.asn}` : ""}{result.activeNet.asn && result.activeNet.org ? " · " : ""}{result.activeNet.org || ""}
              {:else}
                未知
              {/if}
            </dd>
          </div>
        </dl>

        {#if settled && result.network.tags.length}
          <div class="tag-row">
            {#each result.network.tags as tag (tag.label)}
              <span class="mini-tag" data-tone={tag.tone}>{tag.label}</span>
            {/each}
          </div>
        {/if}

        <p class="panel-summary">
          {#if scanning}
            正在并行探测 Claude 分流出口、机房特征、WebRTC、DNS 与域名延迟…
          {:else}
            {result.network.summary}
          {/if}
        </p>
        <p class="panel-footnote">网络链路与本地指纹分项计分，互不叠加。</p>
      </article>

      <article class="metric-panel" data-tone={settled ? riskTone(result.local.riskLevel) : "info"}>
        <div class="panel-top">
          <span class="panel-eyebrow"><Laptop size={14} aria-hidden="true" />本地指纹风险 · 越低越安全</span>
          {#if checkedAt}
            <span class="panel-meta">第 {scanCount} 次 · {checkedAt}</span>
          {/if}
        </div>

        <div class="score-num-row">
          <strong class="score-num" data-tone={settled ? riskTone(result.local.riskLevel) : "info"}>
            {scanning ? "…" : result.local.riskScore}
          </strong>
          <span class="score-max">/ 100</span>
          <span class="score-side">
            {#if scanning}
              <span class="score-pill" data-tone="info">正在检测…</span>
            {:else}
              <span class="score-pill" data-tone={riskTone(result.local.riskLevel)}>{riskLabel(result.local.riskLevel)}</span>
            {/if}
          </span>
        </div>

        <div
          class="score-bar"
          role="progressbar"
          aria-valuenow={settled ? result.local.riskScore : 0}
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div
            class="score-bar-fill"
            data-tone={settled ? riskTone(result.local.riskLevel) : "info"}
            style:width={`${settled ? Math.max(3, result.local.riskScore) : 0}%`}
          ></div>
          {#each LOCAL_MARKS as mark (mark)}
            <span class="score-mark" style:left={`${mark}%`} aria-hidden="true"></span>
          {/each}
        </div>
        <div class="score-scale" aria-hidden="true">
          <span>0</span>
          {#each LOCAL_MARKS as mark (mark)}
            <span style:left={`${mark}%`}>{mark}</span>
          {/each}
          <span>100</span>
        </div>

        <dl class="ip-meta-grid">
          <div>
            <dt>时区对照</dt>
            <dd class="is-mono">{scanning ? "检测中…" : result.local.items[0]?.value || "未知"}</dd>
          </div>
          <div>
            <dt>浏览器语言</dt>
            <dd class="is-mono">{scanning ? "检测中…" : result.local.items[1]?.value || "未知"}</dd>
          </div>
          <div>
            <dt>命中项</dt>
            <dd>
              {#if scanning}
                检测中…
              {:else}
                {localHits > 0 ? `${localHits} / ${result.local.items.length} 项命中风险` : `0 / ${result.local.items.length} 项（全部通过）`}
              {/if}
            </dd>
          </div>
        </dl>

        <p class="panel-summary">
          {#if scanning}
            正在核对时区匹配、语言偏好、厂商字体、浏览器与设备特征…
          {:else}
            {result.local.summary}
          {/if}
        </p>
        <p class="panel-footnote">8 项本地特征独立加权，macOS 预装中文字体不计入风险。</p>
      </article>
    </section>

    <details class="panel-muted trace-fold reveal" style:--i="1" bind:open={traceOpen}>
      <summary class="trace-summary">
        <div class="trace-summary-left">
          <span class="trace-summary-title">手动核验 <code>claude.ai</code> 出口</span>
          <span class="trace-summary-hint">
            {#if claudeTrace}
              已按 {claudeTrace.ip}（{countryLabel(claudeTrace.country)}）校准
            {:else if result.exitMode === "claude_keyword"}
              已通过 {result.activeNet?.host || result.activeNet?.source} 自动识别 Claude 分流出口 · 需要手动覆盖可展开
            {:else}
              若代理仅对 claude.ai 精确分流，可展开粘贴 cdn-cgi/trace 结果校准
            {/if}
          </span>
        </div>
        <ChevronDown size={16} class="trace-chevron" aria-hidden="true" />
      </summary>

      <div class="trace-body">
        <div class="trace-btns">
          <a class="check-btn-ghost" href="https://claude.ai/cdn-cgi/trace" target="_blank" rel="noopener noreferrer">
            <ExternalLink size={14} aria-hidden="true" />
            <span>打开 claude.ai/cdn-cgi/trace</span>
          </a>
          <button type="button" class="check-btn-ghost" onclick={copyCurl}>
            {#if copiedCurl}
              <Check size={14} aria-hidden="true" />
              <span>已复制命令</span>
            {:else}
              <Terminal size={14} aria-hidden="true" />
              <span>复制 curl 命令</span>
            {/if}
          </button>
        </div>

        <textarea
          class="trace-input"
          rows="3"
          bind:value={traceInput}
          placeholder="粘贴 claude.ai/cdn-cgi/trace 内容（包含 ip=... 与 loc=...）"
          aria-label="粘贴 claude.ai/cdn-cgi/trace 内容"
        ></textarea>
        <div class="trace-form-actions">
          <button type="button" class="check-btn-primary" onclick={applyClaudeTrace} disabled={traceLoading || !traceInput.trim()}>
            <span>{traceLoading ? "校准中…" : "应用出口校准"}</span>
          </button>
          {#if claudeTrace}
            <button type="button" class="check-btn-ghost" onclick={clearClaudeTrace}>
              <span>恢复自动检测</span>
            </button>
          {/if}
          {#if traceError}
            <span class="trace-err" role="alert">{traceError}</span>
          {:else if claudeTrace}
            <span class="trace-ok">
              已切换为 claude.ai 出口：{claudeTrace.ip}（{countryLabel(claudeTrace.country)}{claudeTrace.colo ? ` · ${claudeTrace.colo}` : ""}）
            </span>
          {/if}
        </div>
      </div>
    </details>

    {#snippet signalCard(item, FallbackIcon, accentBadge)}
      {@const Icon = ITEM_ICONS[item.id] || FallbackIcon}
      {@const tone = toneOf(item)}
      {#if item.weight === 0}
        <li class="signal-callout" class:is-wide={item.wide} data-tone={tone}>
          <span class="callout-icon" aria-hidden="true"><Icon size={15} /></span>
          <div class="callout-body">
            <div class="callout-head">
              <h3>{item.title}</h3>
              {#if item.badge}
                <span class="signal-badge">{item.badge}</span>
              {/if}
              <span class="callout-view">{scanning ? "…" : "视图"}</span>
            </div>
            <div class="callout-value">{scanning ? "检测中…" : item.value}</div>
            <p class="callout-detail">{item.detail}</p>
          </div>
        </li>
      {:else}
        <li class="signal-card" class:is-wide={item.wide} data-tone={tone}>
          <div class="card-head">
            <div class="card-head-left">
              <div class="signal-icon" data-tone={tone} aria-hidden="true"><Icon size={16} /></div>
              <div class="signal-title-block">
                <div class="signal-title-row">
                  <h3>{item.title}</h3>
                  {#if item.badge}
                    <span class="signal-badge" class:is-accent={accentBadge}>{item.badge}</span>
                  {/if}
                </div>
                <span class="signal-weight">权重 {item.weight}</span>
              </div>
            </div>
            <span class="signal-delta" data-tone={tone}>
              {#if scanning}
                …
              {:else if tone === "ok" && item.score === 0}
                <CircleCheck size={13} aria-hidden="true" />+{item.score}
              {:else}
                +{item.score}
              {/if}
            </span>
          </div>

          <div class="card-value-bar">{scanning ? "检测中…" : item.value}</div>
          <p class="signal-detail">{item.detail}</p>

          {#if item.targets?.length}
            <div class="target-grid">
              {#each item.targets as t (t.id)}
                <span class="target-chip" data-ok={settled ? (t.ok ? "yes" : "no") : "pending"}>
                  <span class="target-dot" aria-hidden="true"></span>
                  <span class="target-host">{t.host}</span>
                  <span class="target-rtt">
                    {#if scanning}
                      …
                    {:else if t.ok}
                      {t.rttMs} ms
                    {:else}
                      {t.error || "不可达"}
                    {/if}
                  </span>
                </span>
              {/each}
            </div>
          {/if}
        </li>
      {/if}
    {/snippet}

    <section class="check-section reveal" style:--i="2" aria-labelledby="net-heading">
      <div class="section-head">
        <div>
          <h2 id="net-heading">一、网络与代理链路</h2>
          <p>覆盖出口地区、机房与代理属性、WebRTC 与 DNS 泄露以及 Claude 域名连通延迟。</p>
        </div>
        <span class="section-score">
          风险分 <b data-tone={settled ? riskTone(result.network.riskLevel) : "info"}>{scanning ? "…" : `+${result.network.riskScore}`}</b> / 100
        </span>
      </div>

      <ul class="signal-grid" class:is-scanning={scanning}>
        {#each result.network.items as item (item.id)}
          {@render signalCard(item, Globe, false)}
        {/each}
      </ul>

      <aside class="dns-note" aria-label="终端与 Claude Code 一键自检">
        <span class="callout-icon" aria-hidden="true"><Terminal size={15} /></span>
        <div class="callout-body">
          <div class="callout-head">
            <strong>终端 / Claude Code 一行自检</strong>
            <span class="signal-badge">macOS / Linux</span>
          </div>
          <p class="callout-detail">
            终端代理环境变量可能与浏览器不一致。在终端运行以下命令，直接核验 <code>claude.ai</code> 实测出口、<code>api.anthropic.com</code> 状态、DNS 泄露与系统时区。
          </p>
          <div class="cli-cmd-row">
            <code class="cli-cmd-code">{CLI_CHECK_CMD}</code>
            <button type="button" class="check-btn-ghost cli-copy-btn" onclick={copyCli}>
              {#if copiedCli}
                <Check size={13} aria-hidden="true" />
                <span>已复制</span>
              {:else}
                <Copy size={13} aria-hidden="true" />
                <span>复制命令</span>
              {/if}
            </button>
          </div>
        </div>
      </aside>
    </section>

    <section class="check-section reveal" style:--i="3" aria-labelledby="local-heading">
      <div class="section-head">
        <div>
          <h2 id="local-heading">二、本地环境指纹</h2>
          <p>8 项本地特征独立拆解，重点排查出口与本机时区差、语言偏好及国产软件终端痕迹。</p>
        </div>
        <span class="section-score">
          风险分 <b data-tone={settled ? riskTone(result.local.riskLevel) : "info"}>{scanning ? "…" : `+${result.local.riskScore}`}</b> / 100
        </span>
      </div>

      <ul class="signal-grid" class:is-scanning={scanning}>
        {#each result.local.items as item (item.id)}
          {@render signalCard(item, Laptop, true)}
        {/each}
      </ul>
    </section>

    {#if settled && result.fixes.length > 0}
      <section class="check-section playbook reveal" style:--i="4" aria-labelledby="fix-heading">
        <div class="section-head">
          <div>
            <h2 id="fix-heading">三、加固建议</h2>
            <p>按本次命中的风险项生成，也可以点右上角「问 AI 加固」获取结合你系统的具体配置步骤。</p>
          </div>
          <span class="section-score"><ListChecks size={14} aria-hidden="true" />{result.fixes.length} 项待处理</span>
        </div>

        <ol class="fix-list">
          {#each result.fixes as fix, idx (fix.title)}
            <li class="fix-card" data-tone={fix.severity}>
              <span class="fix-num" data-tone={fix.severity} aria-hidden="true">{String(idx + 1).padStart(2, "0")}</span>
              <div class="fix-main">
                <div class="fix-head">
                  <h3>{fix.title}</h3>
                  <span class="fix-tag" data-tone={fix.severity}>{fix.severity === "err" ? "优先处理" : "建议优化"}</span>
                </div>
                <p>{fix.body}</p>
              </div>
            </li>
          {/each}
        </ol>

        <div class="playbook-cta">
          <div class="playbook-cta-text">
            <Sparkles size={15} aria-hidden="true" />
            <span>想要按你的系统与代理工具逐步配置？把以上命中项交给 AI，一键生成加固方案。</span>
          </div>
          <button type="button" class="check-ask-btn is-lead is-compact" onclick={openAiFromPlaybook}>
            <Sparkles size={14} aria-hidden="true" />
            <span>问 AI 加固</span>
          </button>
        </div>
      </section>
    {/if}
  {/if}

</div>

<style>
  /* ---------- 页面级表面层级（浅色沿用全站令牌，深色按「明度差 + 极弱描边 + 顶部高光」分层） ---------- */
  .check-page {
    --ck-card: var(--surface);
    --ck-card-hover: color-mix(in srgb, var(--surface2) 55%, var(--surface));
    --ck-well: color-mix(in srgb, var(--ink) 4%, transparent);
    --ck-edge: color-mix(in srgb, var(--ink) 8%, transparent);
    --ck-hi: inset 0 1px 0 rgb(255 255 255 / 0.7);
    --ck-dot: color-mix(in srgb, var(--ink) 12%, transparent);
    --ck-ring: color-mix(in srgb, var(--brand) 14%, transparent);
    --ck-ease: cubic-bezier(0.16, 1, 0.3, 1);
    --mono: var(--font-mono);
    width: 100%;
    padding-bottom: 24px;
    font-variant-numeric: tabular-nums;
  }

  :global(.dark) .check-page {
    --ck-card: rgb(255 255 255 / 0.025);
    --ck-card-hover: rgb(255 255 255 / 0.045);
    --ck-well: rgb(255 255 255 / 0.035);
    --ck-edge: rgb(255 255 255 / 0.06);
    --ck-hi: inset 0 1px 0 rgb(255 255 255 / 0.05);
    --ck-dot: rgb(255 255 255 / 0.07);
    --ck-ring: color-mix(in srgb, var(--brand) 12%, transparent);
  }

  /* ---------- Hero（检测结果顶栏） ---------- */
  .check-hero {
    position: relative;
    z-index: 20;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px 24px;
    padding-bottom: 20px;
    border-bottom: 1px solid var(--ck-edge);
  }

  .check-hero-main {
    flex: 1 1 360px;
    min-width: 0;
  }

  .check-hero-side {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    flex-shrink: 0;
  }

  .check-title {
    margin: 0;
    color: var(--ink);
    font-size: var(--fs-hero);
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.25;
    text-wrap: balance;
  }

  .check-lead {
    margin: 10px 0 0;
    color: var(--ink2);
    font-size: var(--fs-base);
    line-height: 1.65;
    text-wrap: pretty;
  }

  .trace-summary code,
  .dns-note code {
    padding: 1px 5px;
    border-radius: var(--r-xs);
    background: var(--ck-well);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }

  .check-privacy {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--mute);
    font-size: var(--fs-xs);
    line-height: 1.5;
  }

  .check-privacy :global(svg) {
    flex-shrink: 0;
    color: color-mix(in srgb, var(--brand) 70%, var(--mute));
  }

  .check-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }

  /* ---------- 按钮 ---------- */
  .check-btn-cta {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 42px;
    padding: 0 22px;
    border: 1px solid transparent;
    border-radius: var(--r-pill);
    background: var(--brand-solid);
    color: var(--brand-solid-ink);
    font-size: var(--fs-base);
    font-weight: 600;
    box-shadow:
      var(--btn-glint),
      0 0 0 1px color-mix(in srgb, var(--brand) 22%, transparent),
      0 8px 22px -10px color-mix(in srgb, var(--brand) 60%, transparent);
    cursor: pointer;
    transition:
      background-color 0.15s ease,
      box-shadow 0.2s var(--ck-ease),
      transform 0.2s var(--ck-ease),
      opacity 0.15s ease;
  }

  .check-btn-cta:hover:not(:disabled) {
    background: var(--brand-solid-hover);
    transform: translateY(-1px);
    box-shadow:
      var(--btn-glint),
      0 0 0 1px color-mix(in srgb, var(--brand) 32%, transparent),
      0 12px 28px -10px color-mix(in srgb, var(--brand) 72%, transparent);
  }

  .check-btn-cta:active:not(:disabled) {
    transform: translateY(0);
  }

  .check-btn-cta.is-hero {
    height: 50px;
    padding: 0 34px;
    font-size: var(--fs-md);
    letter-spacing: 0.02em;
  }

  .check-btn-cta.is-hero.is-busy:disabled {
    opacity: 0.92;
    cursor: wait;
    box-shadow:
      var(--btn-glint),
      0 0 0 1px color-mix(in srgb, var(--brand) 40%, transparent),
      0 0 0 6px color-mix(in srgb, var(--brand) 14%, transparent),
      0 10px 26px -10px color-mix(in srgb, var(--brand) 72%, transparent);
  }

  /* 存在风险时退为次级暗色按钮，把视线让给「问 AI 加固」 */
  .check-btn-cta.is-quiet {
    border-color: var(--ck-edge);
    background: var(--ck-card);
    color: var(--ink2);
    box-shadow: var(--ck-hi);
  }

  .check-btn-cta.is-quiet:hover:not(:disabled) {
    background: var(--ck-card-hover);
    color: var(--ink);
    box-shadow: var(--ck-hi);
  }

  .check-btn-cta:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .check-btn-primary,
  .check-btn-ghost {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: var(--h-md);
    padding: 0 14px;
    border-radius: var(--r-md);
    font-size: var(--fs-sm);
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, opacity 0.15s ease;
  }

  .check-btn-primary {
    border: 1px solid transparent;
    background: var(--brand-solid);
    color: var(--brand-solid-ink);
    box-shadow: var(--btn-glint);
  }

  .check-btn-primary:hover:not(:disabled) {
    background: var(--brand-solid-hover);
  }

  .check-btn-ghost {
    border: 1px solid var(--ck-edge);
    background: var(--ck-card);
    color: var(--ink);
    box-shadow: var(--ck-hi);
  }

  .check-btn-ghost:hover:not(:disabled) {
    background: var(--ck-card-hover);
    color: var(--brand);
  }

  .check-btn-primary:disabled,
  .check-btn-ghost:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .check-ask {
    position: relative;
    flex: none;
  }

  .check-ask-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 42px;
    padding: 0 20px;
    border: 1px solid color-mix(in srgb, var(--brand) 38%, transparent);
    border-radius: var(--r-pill);
    background: var(--ck-card);
    color: var(--brand);
    font-size: var(--fs-base);
    font-weight: 600;
    box-shadow: var(--ck-hi);
    cursor: pointer;
    transition:
      background-color 0.15s ease,
      border-color 0.15s ease,
      box-shadow 0.2s var(--ck-ease),
      transform 0.2s var(--ck-ease),
      opacity 0.15s ease;
  }

  .check-ask-btn:hover:not(:disabled),
  .check-ask-btn[aria-expanded="true"] {
    background: var(--brand-soft);
    border-color: var(--brand);
  }

  /* 主操作态：主色实底 + 微光描边 + 柔和环境光 */
  .check-ask-btn.is-lead {
    border-color: transparent;
    background: var(--brand-solid);
    color: var(--brand-solid-ink);
    box-shadow:
      var(--btn-glint),
      0 0 0 1px color-mix(in srgb, var(--brand) 45%, transparent),
      0 0 0 4px color-mix(in srgb, var(--brand) 10%, transparent),
      0 10px 26px -10px color-mix(in srgb, var(--brand) 70%, transparent);
  }

  .check-ask-btn.is-lead:hover:not(:disabled),
  .check-ask-btn.is-lead[aria-expanded="true"] {
    background: var(--brand-solid-hover);
    transform: translateY(-1px);
    box-shadow:
      var(--btn-glint),
      0 0 0 1px color-mix(in srgb, var(--brand) 55%, transparent),
      0 0 0 5px color-mix(in srgb, var(--brand) 13%, transparent),
      0 14px 30px -10px color-mix(in srgb, var(--brand) 80%, transparent);
  }

  .check-ask-btn.is-compact {
    height: var(--h-md);
    padding: 0 16px;
    font-size: var(--fs-sm);
  }

  .check-ask-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .check-ask-menu {
    position: absolute;
    z-index: 40;
    top: calc(100% + 8px);
    right: 0;
    left: auto;
    width: min(320px, calc(100vw - 32px));
    padding: 10px;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-lg);
    background: var(--surface);
    box-shadow: var(--ck-hi), var(--shadow-pop);
    animation: ck-pop 0.18s var(--ck-ease);
  }

  .check-ask-note,
  .check-ask-foot {
    margin: 0 4px 6px;
    color: var(--mute);
    font-size: var(--fs-xs);
    line-height: 1.55;
  }

  .check-ask-foot {
    margin: 8px 4px 0;
  }

  .check-ask-item {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 8px;
    min-height: 34px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--ink);
    font-size: var(--fs-sm);
    text-align: left;
    cursor: pointer;
  }

  .check-ask-item:hover,
  .check-ask-item:focus-visible {
    background: var(--brand-soft);
    color: var(--brand);
  }

  .check-ask-sub {
    margin-left: auto;
    color: var(--mute);
    font-size: var(--fs-xs);
  }

  .check-ask-done {
    display: flex;
    align-items: center;
    gap: 5px;
    margin: 8px 4px 0;
    color: var(--brand);
    font-size: var(--fs-xs);
    line-height: 1.45;
  }

  :global(.is-spin) {
    animation: check-spin 0.9s linear infinite;
  }

  @keyframes check-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes ck-pop {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }

  /* ---------- 检测前：首屏居中舞台 ---------- */
  .check-stage {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: clamp(430px, 58vh, 540px);
    padding: 56px 24px 44px;
    border: 1px solid var(--ck-edge);
    border-radius: var(--r-xl);
    background: var(--ck-card);
    box-shadow: var(--ck-hi);
    text-align: center;
    transition: opacity 0.18s var(--ck-ease), transform 0.18s var(--ck-ease), border-color 0.25s ease;
  }

  .check-stage.is-scanning {
    border-color: color-mix(in srgb, var(--brand) 28%, var(--ck-edge));
  }

  .check-stage.is-leaving {
    opacity: 0;
    transform: translateY(-8px) scale(0.99);
    pointer-events: none;
  }

  /* 极克制的青绿径向光晕，铺满舞台营造景深 */
  .check-stage::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -2;
    background: radial-gradient(56% 72% at 50% 48%, color-mix(in srgb, var(--brand) 10%, transparent), transparent 74%);
    transition: opacity 0.25s ease;
  }

  .check-stage.is-scanning::before {
    background: radial-gradient(60% 76% at 50% 48%, color-mix(in srgb, var(--brand) 16%, transparent), transparent 74%);
  }

  /* 暗纹点阵，四周渐隐 */
  .check-stage::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -3;
    background-image: radial-gradient(circle, var(--ck-dot) 1px, transparent 1.4px);
    background-size: 20px 20px;
    background-position: center;
    mask-image: radial-gradient(68% 82% at 50% 50%, #000 18%, transparent 82%);
    -webkit-mask-image: radial-gradient(68% 82% at 50% 50%, #000 18%, transparent 82%);
  }

  .stage-body {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    max-width: 560px;
  }

  .check-stage .check-title {
    font-size: clamp(26px, 3vw, 34px);
    letter-spacing: -0.025em;
  }

  .check-stage .check-lead {
    margin-top: 12px;
    max-width: 34em;
    text-wrap: balance;
  }

  /* 雷达同心刻度 + 扫掠 + 扫描态外扩脉冲 */
  .scan-radar {
    position: absolute;
    top: 50%;
    left: 50%;
    z-index: -1;
    width: 420px;
    height: 420px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    background: repeating-radial-gradient(circle, transparent 0 47px, var(--ck-ring) 47px 48px);
    mask-image: radial-gradient(circle, #000 32%, transparent 72%);
    -webkit-mask-image: radial-gradient(circle, #000 32%, transparent 72%);
    pointer-events: none;
  }

  .scan-sweep {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: conic-gradient(from 0deg, transparent 0deg 285deg, color-mix(in srgb, var(--brand) 9%, transparent) 360deg);
    animation: check-spin 7s linear infinite;
  }

  .check-stage.is-scanning .scan-sweep {
    background: conic-gradient(from 0deg, transparent 0deg 260deg, color-mix(in srgb, var(--brand) 18%, transparent) 360deg);
    animation-duration: 1.4s;
  }

  .scan-pulse {
    position: absolute;
    inset: 18%;
    border-radius: 50%;
    border: 1px solid color-mix(in srgb, var(--brand) 36%, transparent);
    animation: ck-pulse 1.6s var(--ck-ease) infinite;
  }

  @keyframes ck-pulse {
    from {
      opacity: 0.7;
      transform: scale(0.45);
    }
    to {
      opacity: 0;
      transform: scale(1.25);
    }
  }

  .ready-cta-wrap {
    display: flex;
    justify-content: center;
    margin-top: 32px;
  }

  .ready-meta {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 20px;
    margin: 16px 0 0;
    color: var(--mute);
    font-size: var(--fs-xs);
    letter-spacing: 0.02em;
    line-height: 1.5;
  }

  .ready-meta :global(svg) {
    flex-shrink: 0;
    color: color-mix(in srgb, var(--brand) 70%, var(--mute));
  }

  .check-stage.is-scanning .ready-meta {
    color: var(--ink2);
  }

  .stage-scope {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 8px 14px;
    margin: 36px 0 0;
    padding: 18px 0 0;
    border-top: 1px solid var(--ck-edge);
    list-style: none;
    color: var(--mute);
    font-size: var(--fs-xs);
    line-height: 1.5;
  }

  .stage-scope li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .stage-scope li :global(svg) {
    flex-shrink: 0;
    color: color-mix(in srgb, var(--brand) 65%, var(--mute));
  }

  .stage-dot {
    opacity: 0.45;
  }

  /* ---------- 检测后：双维度计分看板 ---------- */
  .dual-board {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    margin-top: 24px;
  }

  .metric-panel {
    --tone: var(--mute);
    position: relative;
    isolation: isolate;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    padding: 20px 22px;
    border: 1px solid var(--ck-edge);
    border-radius: var(--r-lg);
    background: var(--ck-card);
    box-shadow: var(--ck-hi);
  }

  .metric-panel[data-tone="ok"] { --tone: var(--ok-ink); }
  .metric-panel[data-tone="warn"] { --tone: var(--warn-ink); }
  .metric-panel[data-tone="err"] { --tone: var(--err-ink); }

  /* 右上角按风险等级染一层极淡的环境光 */
  .metric-panel::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    background: radial-gradient(70% 60% at 100% 0%, color-mix(in srgb, var(--tone) 6%, transparent), transparent 70%);
    pointer-events: none;
  }

  .panel-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .panel-eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--mute);
    font-size: var(--fs-xs);
    font-weight: 600;
  }

  .panel-eyebrow :global(svg) {
    color: var(--brand);
  }

  .panel-meta {
    color: var(--mute);
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .score-num-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 8px;
    margin-top: 10px;
  }

  .score-num {
    font-family: var(--font-mono);
    font-size: 46px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    letter-spacing: -0.04em;
    color: var(--ink);
  }

  .score-num[data-tone="ok"] { color: var(--ok-ink); }
  .score-num[data-tone="warn"] { color: var(--warn-ink); }
  .score-num[data-tone="err"] { color: var(--err-ink); }

  .score-max {
    color: var(--mute);
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    opacity: 0.8;
  }

  .score-side {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    margin-left: 6px;
    align-self: center;
  }

  .score-pill {
    display: inline-flex;
    align-items: center;
    padding: 2px 9px;
    border-radius: var(--r-pill);
    background: var(--info-bg);
    color: var(--info-ink);
    font-size: var(--fs-xs);
    font-weight: 600;
    white-space: nowrap;
  }

  .score-pill[data-tone="ok"] {
    background: color-mix(in srgb, var(--ok-ink) 12%, transparent);
    color: var(--ok-ink);
  }

  .score-pill[data-tone="warn"] {
    background: color-mix(in srgb, var(--warn-ink) 13%, transparent);
    color: var(--warn-ink);
  }

  .score-pill[data-tone="err"] {
    background: color-mix(in srgb, var(--err-ink) 13%, transparent);
    color: var(--err-ink);
  }

  .score-source {
    color: var(--mute);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }

  /* 带刻度与阈值标记的风险进度槽 */
  .score-bar {
    position: relative;
    height: 8px;
    margin-top: 18px;
    border-radius: var(--r-pill);
    background: var(--ck-well);
    box-shadow: inset 0 1px 1px rgb(0 0 0 / 0.08);
  }

  .score-bar::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: repeating-linear-gradient(
      90deg,
      transparent 0,
      transparent calc(10% - 1px),
      var(--ck-edge) calc(10% - 1px),
      var(--ck-edge) 10%
    );
    pointer-events: none;
  }

  .score-bar-fill {
    --fill: var(--mute);
    position: relative;
    z-index: 1;
    height: 100%;
    border-radius: var(--r-pill);
    background: linear-gradient(90deg, color-mix(in srgb, var(--fill) 55%, transparent), var(--fill));
    box-shadow: 0 0 12px -1px color-mix(in srgb, var(--fill) 55%, transparent);
    transition: width 0.5s var(--ck-ease);
  }

  .score-bar-fill[data-tone="ok"] { --fill: var(--ok-ink); }
  .score-bar-fill[data-tone="warn"] { --fill: var(--warn-ink); }
  .score-bar-fill[data-tone="err"] { --fill: var(--err-ink); }

  .score-mark {
    position: absolute;
    top: -3px;
    bottom: -3px;
    z-index: 2;
    width: 1px;
    background: color-mix(in srgb, var(--ink) 28%, transparent);
  }

  .score-scale {
    position: relative;
    display: flex;
    justify-content: space-between;
    height: 14px;
    margin-top: 6px;
    color: var(--mute);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    line-height: 14px;
    opacity: 0.75;
  }

  .score-scale span[style] {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
  }

  /* 键值对：固定 Label 列宽，Value 高亮对齐 */
  .ip-meta-grid {
    display: grid;
    margin: 14px 0 0;
  }

  .ip-meta-grid > div {
    display: grid;
    grid-template-columns: 76px minmax(0, 1fr);
    gap: 12px;
    align-items: baseline;
    padding: 7px 0;
    border-top: 1px solid var(--ck-edge);
  }

  .ip-meta-grid dt {
    color: var(--mute);
    font-size: var(--fs-xs);
  }

  .ip-meta-grid dd {
    margin: 0;
    color: var(--ink);
    font-size: var(--fs-sm);
    font-variant-numeric: tabular-nums;
    line-height: 1.45;
    word-break: break-word;
  }

  .ip-meta-grid dd.is-mono {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }

  .tag-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }

  .mini-tag {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--r-pill);
    background: var(--ck-well);
    color: var(--info-ink);
    font-size: var(--fs-2xs);
    font-weight: 600;
  }

  .mini-tag[data-tone="ok"] {
    background: color-mix(in srgb, var(--ok-ink) 11%, transparent);
    color: var(--ok-ink);
  }

  .mini-tag[data-tone="warn"] {
    background: color-mix(in srgb, var(--warn-ink) 12%, transparent);
    color: var(--warn-ink);
  }

  .mini-tag[data-tone="err"] {
    background: color-mix(in srgb, var(--err-ink) 12%, transparent);
    color: var(--err-ink);
  }

  .panel-summary {
    margin: 12px 0 0;
    color: var(--ink2);
    font-size: var(--fs-sm);
    line-height: 1.6;
  }

  .panel-footnote {
    margin: auto 0 0;
    padding-top: 10px;
    color: var(--mute);
    font-size: var(--fs-xs);
    line-height: 1.5;
  }

  /* ---------- 手动核验折叠 ---------- */
  .trace-fold {
    margin-top: 12px;
    padding: 0;
    background: var(--ck-well);
  }

  .trace-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    cursor: pointer;
    list-style: none;
  }

  .trace-summary::-webkit-details-marker {
    display: none;
  }

  .trace-summary-left {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px 12px;
    min-width: 0;
  }

  .trace-summary-title {
    color: var(--ink);
    font-size: var(--fs-sm);
    font-weight: 600;
  }

  .trace-summary-hint {
    color: var(--mute);
    font-size: var(--fs-xs);
    line-height: 1.5;
  }

  .trace-fold :global(.trace-chevron) {
    flex-shrink: 0;
    color: var(--mute);
    transition: transform 0.25s var(--ck-ease);
  }

  .trace-fold[open] :global(.trace-chevron) {
    transform: rotate(180deg);
  }

  .trace-body {
    padding: 0 16px 16px;
    border-top: 1px solid var(--ck-edge);
  }

  .trace-btns {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }

  .trace-input {
    width: 100%;
    margin-top: 10px;
    padding: 10px 12px;
    border: 1px solid var(--ck-edge);
    border-radius: var(--r-md);
    background: var(--ck-card);
    color: var(--ink);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    line-height: 1.5;
    resize: vertical;
  }

  .trace-input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .trace-form-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
  }

  .trace-err {
    color: var(--err-ink);
    font-size: var(--fs-xs);
    font-weight: 500;
  }

  .trace-ok {
    color: var(--ok-ink);
    font-size: var(--fs-xs);
    font-weight: 600;
  }

  /* ---------- 区块标题：区块间留白放大，区块内保持紧凑 ---------- */
  .check-section {
    margin-top: 44px;
  }

  .section-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
  }

  .section-head h2 {
    margin: 0;
    color: var(--ink);
    font-size: var(--fs-xl);
    font-weight: 700;
    line-height: 1.3;
  }

  .section-head p {
    margin: 4px 0 0;
    color: var(--mute);
    font-size: var(--fs-sm);
    line-height: 1.55;
  }

  .section-score {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 5px;
    color: var(--mute);
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .section-score b {
    color: var(--ink2);
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    font-weight: 700;
  }

  .section-score b[data-tone="ok"] { color: var(--ok-ink); }
  .section-score b[data-tone="warn"] { color: var(--warn-ink); }
  .section-score b[data-tone="err"] { color: var(--err-ink); }

  /* ---------- 检测明细卡：安全项退后，风险项跳出 ---------- */
  .signal-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
    transition: opacity 0.2s ease;
  }

  .signal-grid.is-scanning {
    opacity: 0.6;
  }

  .signal-card {
    --tone: transparent;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 15px 16px 16px;
    border: 1px solid var(--ck-edge);
    border-radius: var(--r-lg);
    background: var(--ck-card);
    box-shadow: var(--ck-hi);
    transition: background-color 0.2s ease, box-shadow 0.2s ease;
  }

  .signal-card:hover {
    background-color: var(--ck-card-hover);
  }

  .signal-card.is-wide {
    grid-column: 1 / -1;
  }

  /* 风险项：左上角局部径向染色 + 顶边状态色高光，不画整圈彩框 */
  .signal-card[data-tone="warn"] { --tone: var(--warn-ink); }
  .signal-card[data-tone="err"] { --tone: var(--err-ink); }

  .signal-card[data-tone="warn"],
  .signal-card[data-tone="err"] {
    background-image: radial-gradient(
      90% 120% at 0% 0%,
      color-mix(in srgb, var(--tone) 9%, transparent),
      color-mix(in srgb, var(--tone) 3%, transparent) 45%,
      transparent 75%
    );
    border-color: color-mix(in srgb, var(--tone) 16%, var(--ck-edge));
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--tone) 22%, transparent),
      0 8px 24px -16px color-mix(in srgb, var(--tone) 45%, transparent);
  }

  .card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
  }

  .card-head-left {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    min-width: 0;
  }

  .signal-icon {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: var(--r-md);
    background: var(--ck-well);
    color: var(--mute);
  }

  .signal-icon[data-tone="warn"] {
    background: color-mix(in srgb, var(--warn-ink) 13%, transparent);
    color: var(--warn-ink);
  }

  .signal-icon[data-tone="err"] {
    background: color-mix(in srgb, var(--err-ink) 13%, transparent);
    color: var(--err-ink);
  }

  .signal-title-block {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .signal-title-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .signal-title-row h3 {
    margin: 0;
    color: var(--ink);
    font-size: var(--fs-md);
    font-weight: 600;
    line-height: 1.35;
  }

  .signal-weight {
    color: var(--mute);
    font-size: var(--fs-2xs);
    font-variant-numeric: tabular-nums;
    line-height: 1.5;
    opacity: 0.85;
  }

  .signal-badge {
    display: inline-flex;
    align-items: center;
    padding: 0 7px;
    border-radius: var(--r-pill);
    background: color-mix(in srgb, var(--brand) 12%, transparent);
    color: var(--brand);
    font-size: var(--fs-2xs);
    font-weight: 600;
    line-height: 1.7;
  }

  .signal-badge.is-accent {
    background: color-mix(in srgb, var(--warn-ink) 12%, transparent);
    color: var(--warn-ink);
  }

  .card-value-bar {
    padding: 8px 10px;
    border-radius: var(--r-md);
    background: var(--ck-well);
    color: var(--ink);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
    line-height: 1.55;
    word-break: break-word;
  }

  .signal-detail {
    margin: 0;
    color: var(--mute);
    font-size: var(--fs-sm);
    line-height: 1.6;
  }

  .signal-delta {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-width: 36px;
    padding: 2px 4px;
    color: var(--mute);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* 安全项：只留一枚淡绿对勾 + 纯文字，不做彩色胶囊 */
  .signal-delta[data-tone="ok"] {
    color: color-mix(in srgb, var(--ok-ink) 75%, var(--mute));
    font-weight: 400;
  }

  .signal-delta[data-tone="warn"],
  .signal-delta[data-tone="err"] {
    min-width: 44px;
    padding: 2px 9px;
    border-radius: var(--r-pill);
  }

  .signal-delta[data-tone="warn"] {
    background: color-mix(in srgb, var(--warn-ink) 15%, transparent);
    color: var(--warn-ink);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--warn-ink) 25%, transparent);
  }

  .signal-delta[data-tone="err"] {
    background: color-mix(in srgb, var(--err-ink) 15%, transparent);
    color: var(--err-ink);
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--err-ink) 28%, transparent),
      0 0 14px -4px color-mix(in srgb, var(--err-ink) 60%, transparent);
  }

  .target-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .target-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 9px;
    border-radius: var(--r-sm);
    background: var(--ck-well);
    font-size: var(--fs-xs);
    line-height: 1.4;
  }

  .target-dot {
    width: 6px;
    height: 6px;
    border-radius: var(--r-pill);
    background: var(--mute);
  }

  .target-chip[data-ok="yes"] .target-dot {
    background: var(--ok-ink);
    box-shadow: 0 0 6px color-mix(in srgb, var(--ok-ink) 60%, transparent);
  }

  .target-chip[data-ok="no"] .target-dot {
    background: var(--err-ink);
    box-shadow: 0 0 6px color-mix(in srgb, var(--err-ink) 60%, transparent);
  }

  .target-host {
    color: var(--ink);
    font-family: var(--font-mono);
  }

  .target-rtt {
    color: var(--mute);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  /* ---------- 横幅信息条（多路分流对照 / DNS 核对建议） ---------- */
  .signal-callout,
  .dns-note {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 14px;
    border-radius: var(--r-md);
    background: var(--ck-well);
  }

  .signal-callout.is-wide {
    grid-column: 1 / -1;
  }

  .dns-note {
    margin-top: 10px;
  }

  .cli-cmd-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
  }

  .cli-cmd-code {
    flex: 1 1 280px;
    min-width: 0;
    padding: 7px 10px;
    border: 1px solid var(--ck-edge);
    border-radius: var(--r-sm);
    background: var(--ck-card);
    color: var(--ink);
    font-family: var(--mono);
    font-size: 12px;
    line-height: 1.4;
    overflow-x: auto;
    white-space: nowrap;
  }

  .cli-copy-btn {
    flex-shrink: 0;
    padding: 6px 10px;
    font-size: 12px;
  }

  .callout-icon {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--brand) 12%, transparent);
    color: var(--brand);
  }

  .callout-body {
    flex: 1;
    min-width: 0;
  }

  .callout-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
    min-height: 26px;
  }

  .callout-head h3,
  .callout-head strong {
    margin: 0;
    color: var(--ink);
    font-size: var(--fs-sm);
    font-weight: 600;
    line-height: 1.4;
  }

  .callout-view {
    margin-left: auto;
    color: var(--mute);
    font-size: var(--fs-2xs);
  }

  .callout-value {
    margin-top: 2px;
    color: var(--ink);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
    line-height: 1.55;
    word-break: break-word;
  }

  .callout-detail {
    margin: 4px 0 0;
    color: var(--mute);
    font-size: var(--fs-xs);
    line-height: 1.6;
  }

  /* ---------- 三、加固建议：可执行任务清单 ---------- */
  .fix-list {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .fix-card {
    --tone: var(--warn-ink);
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 14px;
    align-items: start;
    padding: 16px 18px;
    border: 1px solid var(--ck-edge);
    border-radius: var(--r-lg);
    background: var(--ck-card);
    box-shadow: var(--ck-hi);
    transition: background-color 0.2s ease;
  }

  .fix-card:hover {
    background-color: var(--ck-card-hover);
  }

  .fix-card[data-tone="err"] {
    --tone: var(--err-ink);
  }

  .fix-num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: var(--r-md);
    background: color-mix(in srgb, var(--tone) 13%, transparent);
    color: var(--tone);
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tone) 24%, transparent);
  }

  .fix-main {
    min-width: 0;
  }

  .fix-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    min-height: 36px;
    padding-top: 7px;
  }

  .fix-head h3 {
    margin: 0;
    color: var(--ink);
    font-size: var(--fs-md);
    font-weight: 600;
    line-height: 1.45;
  }

  .fix-tag {
    flex-shrink: 0;
    padding: 1px 9px;
    border-radius: var(--r-pill);
    background: color-mix(in srgb, var(--tone) 13%, transparent);
    color: var(--tone);
    font-size: var(--fs-2xs);
    font-weight: 600;
    line-height: 1.7;
    white-space: nowrap;
  }

  .fix-card p {
    margin: 2px 0 0;
    color: var(--ink2);
    font-size: var(--fs-sm);
    line-height: 1.65;
  }

  .playbook-cta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px 16px;
    margin-top: 12px;
    padding: 14px 16px;
    border-radius: var(--r-lg);
    background:
      radial-gradient(60% 140% at 0% 50%, color-mix(in srgb, var(--brand) 9%, transparent), transparent 70%),
      var(--ck-well);
  }

  .playbook-cta-text {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    color: var(--ink2);
    font-size: var(--fs-sm);
    line-height: 1.55;
  }

  .playbook-cta-text :global(svg) {
    flex-shrink: 0;
    color: var(--brand);
  }

  /* ---------- 进场动效：按区块顺序轻微上浮淡入，总时长 ≤ 360ms ---------- */
  .reveal {
    animation: ck-reveal 0.26s var(--ck-ease) both;
    animation-delay: calc(var(--i, 0) * 35ms);
  }

  @keyframes ck-reveal {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .reveal,
    .check-ask-menu,
    .scan-sweep,
    .scan-pulse {
      animation: none;
    }

    .check-stage,
    .check-btn-cta,
    .check-ask-btn,
    .score-bar-fill {
      transition: none;
    }
  }

  @media (max-width: 860px) {
    .check-hero-side {
      align-items: flex-start;
      width: 100%;
    }

    .dual-board,
    .signal-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .check-ask-menu {
      right: auto;
      left: 0;
    }
  }

  @media (max-width: 560px) {
    .check-stage {
      min-height: 380px;
      padding: 40px 18px 32px;
    }

    .scan-radar {
      width: 280px;
      height: 280px;
    }

    .stage-dot {
      display: none;
    }

    .stage-scope {
      gap: 6px 14px;
      margin-top: 28px;
      padding-top: 14px;
    }

    .score-num {
      font-size: 40px;
    }

    .section-head {
      flex-direction: column;
      align-items: flex-start;
    }

    .fix-card {
      gap: 12px;
      padding: 14px;
    }

    .fix-head {
      flex-direction: column;
      gap: 4px;
    }
  }
</style>
