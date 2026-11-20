<script>
  import { onMount, tick } from "svelte";
  import {
    Activity,
    Check,
    ChevronDown,
    Clock,
    Compass,
    Copy,
    ExternalLink,
    Globe,
    Languages,
    Laptop,
    Lock,
    Network,
    Play,
    RefreshCw,
    ShieldAlert,
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
    probeOverseasIp,
    probeSiteEdge,
    probeWebRTC,
  } from "./env-check.js";

  const ITEM_ICONS = {
    overseas_region: Globe,
    ip_purity: ShieldCheck,
    webrtc_leak: Wifi,
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

  const INITIAL_STATE = evaluateCheck({
    claude: CLAUDE_TARGETS.map((t) => ({ ...t, ok: true, rttMs: null })),
  });

  let ready = $state(false);
  let scanning = $state(false);
  let scannedOnce = $state(false);
  let scanCount = $state(0);
  let checkedAt = $state("");
  let copiedCurl = $state(false);
  let result = $state(INITIAL_STATE);

  let lastSignals = $state({ edge: null, claudeEdge: null, overseas: null, webrtc: null, claude: [], local: null });
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
    scanning = true;
    aiOpen = false;
    aiDone = "";
    const started = performance.now();
    try {
      const [rawEdge, rawClaudeEdge, overseas, webrtc, claude, local] = await Promise.all([
        probeSiteEdge(),
        probeClaudeEdge(),
        probeOverseasIp(),
        probeWebRTC(),
        probeClaudeTargets(),
        collectLocalSignals(),
      ]);

      let edge = rawEdge;
      let claudeEdge = rawClaudeEdge;

      if (rawClaudeEdge?.ok && rawClaudeEdge.ip && rawClaudeEdge.ip !== overseas?.ip) {
        claudeEdge = mergeIpMeta(rawClaudeEdge, await lookupIpMetadata(rawClaudeEdge.ip, 3200));
      } else if (!rawClaudeEdge?.ok && rawEdge?.ok && rawEdge.isClaudeKeywordHit && rawEdge.ip && rawEdge.ip !== overseas?.ip) {
        edge = mergeIpMeta(rawEdge, await lookupIpMetadata(rawEdge.ip, 3200));
      }

      const elapsed = performance.now() - started;
      if (elapsed < 360) {
        await new Promise((r) => setTimeout(r, 360 - elapsed));
      }
      lastSignals = { edge, claudeEdge, overseas, webrtc, claude, local };
      result = evaluateCheck({ ...lastSignals, claudeTrace });
      scanCount += 1;
      checkedAt = new Date().toLocaleTimeString("zh-CN", { hour12: false });
      scannedOnce = true;
    } finally {
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
      const merged = mergeIpMeta(parsed, meta);
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

<div class="check-page">
  <header class="check-hero">
    <div class="check-hero-main">
      <div class="check-kicker">Claude 环境与 IP 风险检测</div>
      <h1 class="check-title">登录 Claude 前，先查清封号隐患</h1>
      <p class="check-lead">
        一键扫描当前网络出口与本机环境，找出容易触发 Anthropic 风控的破绽，并给出对应改法。
      </p>

      {#if scannedOnce || scanning}
        <div class="check-hero-foot">
          <div class="check-actions">
            <button type="button" class="check-btn-cta" onclick={runScan} disabled={!ready || scanning}>
              {#if scanning}
                <RefreshCw size={16} class="is-spin" aria-hidden="true" />
                <span>正在检测…</span>
              {:else}
                <RefreshCw size={16} aria-hidden="true" />
                <span>重新检测</span>
              {/if}
            </button>

            {#if scannedOnce}
              <div class="check-ask" bind:this={aiRoot}>
                <button
                  bind:this={aiBtn}
                  type="button"
                  class="check-ask-btn"
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
            {/if}
          </div>

          <p class="check-privacy">
            <Lock size={14} aria-hidden="true" />
            <span>本地运算，结果仅当前页面可见</span>
          </p>
        </div>
      {/if}
    </div>
  </header>

  {#if !scannedOnce && !scanning}
    <section class="ready-board" aria-label="开始环境检测">
      <div class="ready-head">
        <div class="ready-cta-wrap">
          <button type="button" class="check-btn-cta is-hero" onclick={runScan} disabled={!ready || scanning}>
            {#if !ready}
              <RefreshCw size={17} class="is-spin" aria-hidden="true" />
              <span>准备中…</span>
            {:else}
              <Play size={17} aria-hidden="true" />
              <span>一键自检</span>
            {/if}
          </button>
        </div>
        <p class="ready-meta"><Lock size={13} aria-hidden="true" />约 2 秒完成 · 仅在本地运行</p>
      </div>

      <div class="ready-grid">
        <div class="ready-card">
          <h3><Network size={15} aria-hidden="true" />查清出口节点</h3>
          <p>识别访问 Claude 时的真实出口 IP，确认地区是否受支持、是否落在高危共享机房。</p>
        </div>
        <div class="ready-card">
          <h3><Laptop size={15} aria-hidden="true" />查出本机破绽</h3>
          <p>核对出口与电脑时区是否一致，排查 WebRTC 泄露、中文语言请求头与国产软件特征。</p>
        </div>
        <div class="ready-card">
          <h3><Sparkles size={15} aria-hidden="true" />直接给出改法</h3>
          <p>针对每项命中的风险提供排查步骤；也可以一键交给 AI，按你的系统与代理工具生成配置方案。</p>
        </div>
      </div>
    </section>
  {:else}
    <section class="dual-board" aria-live="polite" aria-label="双维度独立风险评分">
      <article class="metric-panel">
        <div class="panel-top">
          <div>
            <span class="panel-eyebrow"><Network size={14} aria-hidden="true" />网络与代理风险 · 越低越安全</span>
            <div class="score-num-row">
              <strong class="score-num" data-tone={scannedOnce && !scanning ? riskTone(result.network.riskLevel) : "info"}>
                {scanning ? "…" : result.network.riskScore}
              </strong>
              <span class="score-max">/ 100</span>
              {#if scanning}
                <span class="score-pill" data-tone="info">正在检测…</span>
              {:else}
                <span class="score-pill" data-tone={riskTone(result.network.riskLevel)}>{riskLabel(result.network.riskLevel)}</span>
                <span class="score-pill is-brand">{result.exitModeLabel}</span>
              {/if}
            </div>
          </div>
          {#if scannedOnce && !scanning}
            <span class="type-pill">{result.network.ipTypeLabel}</span>
          {/if}
        </div>

        <div class="score-bar" role="progressbar" aria-valuenow={scannedOnce && !scanning ? result.network.riskScore : 0} aria-valuemin="0" aria-valuemax="100">
          <div
            class="score-bar-fill"
            data-tone={scannedOnce && !scanning ? riskTone(result.network.riskLevel) : "info"}
            style:width={`${scannedOnce && !scanning ? Math.max(4, result.network.riskScore) : 0}%`}
          ></div>
        </div>

        <dl class="ip-meta-grid">
          <div>
            <dt>出口 IP</dt>
            <dd>{scanning ? "检测中…" : result.activeNet?.ip || "未获取到"}</dd>
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
            <dd>
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

        {#if scannedOnce && !scanning && result.network.tags.length}
          <div class="tag-row">
            {#each result.network.tags as tag (tag.label)}
              <span class="mini-tag" data-tone={tag.tone}>{tag.label}</span>
            {/each}
          </div>
        {/if}

        <p class="panel-summary">
          {#if scanning}
            正在并行探测 Claude 分流出口、机房特征、WebRTC 与域名延迟…
          {:else}
            {result.network.summary}
          {/if}
        </p>
        <p class="panel-footnote">网络链路与本地指纹分项计分，互不叠加。</p>
      </article>

      <article class="metric-panel">
        <div class="panel-top">
          <div>
            <span class="panel-eyebrow"><Laptop size={14} aria-hidden="true" />本地指纹风险 · 越低越安全</span>
            <div class="score-num-row">
              <strong class="score-num" data-tone={scannedOnce && !scanning ? riskTone(result.local.riskLevel) : "info"}>
                {scanning ? "…" : result.local.riskScore}
              </strong>
              <span class="score-max">/ 100</span>
              {#if scanning}
                <span class="score-pill" data-tone="info">正在检测…</span>
              {:else}
                <span class="score-pill" data-tone={riskTone(result.local.riskLevel)}>{riskLabel(result.local.riskLevel)}</span>
              {/if}
            </div>
          </div>
          {#if checkedAt}
            <span class="score-time">第 {scanCount} 次 · {checkedAt}</span>
          {/if}
        </div>

        <div class="score-bar" role="progressbar" aria-valuenow={scannedOnce && !scanning ? result.local.riskScore : 0} aria-valuemin="0" aria-valuemax="100">
          <div
            class="score-bar-fill"
            data-tone={scannedOnce && !scanning ? riskTone(result.local.riskLevel) : "info"}
            style:width={`${scannedOnce && !scanning ? Math.max(4, result.local.riskScore) : 0}%`}
          ></div>
        </div>

        <dl class="ip-meta-grid">
          <div>
            <dt>时区对照</dt>
            <dd>{scanning ? "检测中…" : result.local.items[0]?.value || "未知"}</dd>
          </div>
          <div>
            <dt>浏览器语言</dt>
            <dd>{scanning ? "检测中…" : result.local.items[1]?.value || "未知"}</dd>
          </div>
          <div>
            <dt>命中项</dt>
            <dd>
              {#if scanning}
                检测中…
              {:else}
                {@const hits = result.local.items.filter((x) => x.score > 0).length}
                {hits > 0 ? `${hits} / ${result.local.items.length} 项命中风险` : `0 / ${result.local.items.length} 项（全部通过）`}
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

    <details class="panel-muted trace-fold" bind:open={traceOpen}>
      <summary class="trace-summary">
        <div class="trace-summary-left">
          <span class="trace-summary-title">手动核验 <code>claude.ai</code> 出口</span>
          <span class="trace-summary-hint">
            {#if claudeTrace}
              已按 {claudeTrace.ip}（{countryLabel(claudeTrace.country)}）校准
            {:else if result.exitMode === "claude_keyword"}
              已通过 {result.activeNet?.host || "当前域名"} 自动识别 Claude 分流出口 · 需要手动覆盖可展开
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

    <section class="check-section" aria-labelledby="net-heading">
      <div class="section-head">
        <div>
          <h2 id="net-heading">一、网络与代理链路</h2>
          <p>覆盖出口地区、机房与代理属性、WebRTC 地址泄露和 Claude 域名连通延迟。</p>
        </div>
        <span class="section-score">风险分 {scanning ? "…" : `+${result.network.riskScore}`} / 100</span>
      </div>

      <ul class="signal-grid" class:is-scanning={scanning}>
        {#each result.network.items as item (item.id)}
          {@const Icon = ITEM_ICONS[item.id] || Globe}
          <li class="signal-card" class:is-wide={item.wide} data-tone={scannedOnce && !scanning ? item.status : "info"}>
            <div class="card-head">
              <div class="card-head-left">
                <div class="signal-icon" data-tone={scannedOnce && !scanning ? item.status : "info"} aria-hidden="true"><Icon size={16} /></div>
                <div class="signal-title-row">
                  <h3>{item.title}</h3>
                  {#if item.weight > 0}
                    <span class="signal-weight">权重 {item.weight}</span>
                  {/if}
                  {#if item.badge}
                    <span class="signal-badge">{item.badge}</span>
                  {/if}
                </div>
              </div>
              <span class="signal-delta" data-tone={scannedOnce && !scanning ? item.status : "info"}>
                {#if scanning}
                  …
                {:else if item.weight === 0}
                  视图
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
                  <span class="target-chip" data-ok={scannedOnce && !scanning ? (t.ok ? "yes" : "no") : "pending"}>
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
        {/each}
      </ul>

      <aside class="panel-muted dns-note" aria-label="DNS 解析核对建议">
        <div class="dns-note-head">
          <ShieldAlert size={16} aria-hidden="true" />
          <strong>DNS 解析核对建议</strong>
        </div>
        <p>
          浏览器无法读取系统 DNS 配置，这项需要到代理客户端里自行确认。建议开启
          <strong>Fake-IP 与 Tun 模式</strong>，让 <code>claude.ai</code> 和 <code>anthropic.com</code> 走远程 DNS 解析，避免回退到本地宽带 DNS 或 <code>223.5.5.5</code>。
        </p>
      </aside>
    </section>

    <section class="check-section" aria-labelledby="local-heading">
      <div class="section-head">
        <div>
          <h2 id="local-heading">二、本地环境指纹</h2>
          <p>8 项本地特征独立拆解，重点排查出口与本机时区差、语言偏好及国产软件终端痕迹。</p>
        </div>
        <span class="section-score">风险分 {scanning ? "…" : `+${result.local.riskScore}`} / 100</span>
      </div>

      <ul class="signal-grid" class:is-scanning={scanning}>
        {#each result.local.items as item (item.id)}
          {@const Icon = ITEM_ICONS[item.id] || Laptop}
          <li class="signal-card" data-tone={scannedOnce && !scanning ? item.status : "info"}>
            <div class="card-head">
              <div class="card-head-left">
                <div class="signal-icon" data-tone={scannedOnce && !scanning ? item.status : "info"} aria-hidden="true"><Icon size={16} /></div>
                <div class="signal-title-row">
                  <h3>{item.title}</h3>
                  <span class="signal-weight">权重 {item.weight}</span>
                  {#if item.badge}
                    <span class="signal-badge is-accent">{item.badge}</span>
                  {/if}
                </div>
              </div>
              <span class="signal-delta" data-tone={scannedOnce && !scanning ? item.status : "info"}>
                {scanning ? "…" : `+${item.score}`}
              </span>
            </div>

            <div class="card-value-bar">{scanning ? "检测中…" : item.value}</div>
            <p class="signal-detail">{item.detail}</p>
          </li>
        {/each}
      </ul>
    </section>

    {#if scannedOnce && !scanning && result.fixes.length > 0}
      <section class="check-section" aria-labelledby="fix-heading">
        <div class="section-head">
          <div>
            <h2 id="fix-heading">三、加固建议</h2>
            <p>按本次命中的风险项生成，也可以点右上角「问 AI 加固」获取结合你系统的具体配置步骤。</p>
          </div>
        </div>

        <ol class="fix-grid" class:is-single={result.fixes.length === 1}>
          {#each result.fixes as fix, idx (fix.title)}
            <li class="fix-card" data-tone={fix.severity}>
              <div class="fix-head">
                <span class="fix-num" data-tone={fix.severity} aria-hidden="true">{String(idx + 1).padStart(2, "0")}</span>
                <h3>{fix.title}</h3>
                <span class="fix-tag" data-tone={fix.severity}>{fix.severity === "err" ? "优先处理" : "建议优化"}</span>
              </div>
              <p>{fix.body}</p>
            </li>
          {/each}
        </ol>
      </section>
    {/if}
  {/if}
</div>

<style>
  .check-page {
    width: 100%;
    padding-bottom: 24px;
  }

  .check-hero {
    padding-bottom: 20px;
    border-bottom: 1px solid var(--line);
  }

  .check-hero-main {
    min-width: 0;
  }

  .check-hero-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px 16px;
    margin-top: 14px;
  }

  .check-kicker {
    color: var(--brand);
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
  }

  .check-title {
    margin: 6px 0 0;
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
    background: var(--surface2);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }

  .check-privacy {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    padding: 6px 10px;
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--surface2);
    color: var(--mute);
    font-size: var(--fs-xs);
    line-height: 1.5;
  }

  .check-privacy :global(svg) {
    flex-shrink: 0;
    color: var(--brand);
  }

  .check-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }

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
    box-shadow: var(--btn-glint), 0 6px 18px -6px color-mix(in srgb, var(--brand) 55%, transparent);
    cursor: pointer;
    transition: background-color 0.15s ease, transform 0.15s ease, opacity 0.15s ease;
  }

  .check-btn-cta.is-hero {
    height: 48px;
    padding: 0 32px;
    font-size: var(--fs-md);
  }

  .check-btn-cta:hover:not(:disabled) {
    background: var(--brand-solid-hover);
    transform: translateY(-1px);
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
    transition: background-color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
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
    border: 1px solid var(--line-strong);
    background: var(--surface);
    color: var(--ink);
  }

  .check-btn-ghost:hover:not(:disabled) {
    border-color: var(--brand);
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
    border: 1px solid color-mix(in srgb, var(--brand) 48%, var(--line));
    border-radius: var(--r-pill);
    background: var(--surface);
    color: var(--brand);
    font-size: var(--fs-base);
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
  }

  .check-ask-btn:hover:not(:disabled),
  .check-ask-btn[aria-expanded="true"] {
    background: var(--brand-soft);
    border-color: var(--brand);
  }

  .check-ask-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .check-ask-menu {
    position: absolute;
    z-index: 30;
    top: calc(100% + 6px);
    left: 0;
    width: min(320px, calc(100vw - 32px));
    padding: 10px;
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    background: var(--surface);
    box-shadow: var(--shadow-pop);
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

  .ready-board {
    margin-top: 20px;
    padding: 28px 24px 24px;
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    background: var(--card-grad);
    box-shadow: var(--shadow-card);
  }

  .ready-head {
    text-align: center;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--line);
  }

  .ready-cta-wrap {
    display: flex;
    justify-content: center;
  }

  .ready-meta {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin: 12px 0 0;
    color: var(--mute);
    font-size: var(--fs-xs);
    line-height: 1.5;
  }

  .ready-meta :global(svg) {
    color: var(--brand);
    flex-shrink: 0;
  }

  .ready-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
    margin-top: 20px;
  }

  .ready-card {
    padding: 16px 18px;
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--surface);
  }

  .ready-card h3 {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    margin: 0;
    color: var(--ink);
    font-size: var(--fs-md);
    font-weight: 600;
  }

  .ready-card h3 :global(svg) {
    color: var(--brand);
  }

  .ready-card p {
    margin: 8px 0 0;
    color: var(--ink2);
    font-size: var(--fs-sm);
    line-height: 1.6;
  }

  .dual-board {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    margin-top: 20px;
  }

  .metric-panel {
    display: flex;
    flex-direction: column;
    padding: 18px 20px;
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    background: var(--card-grad);
    box-shadow: var(--shadow-card);
  }

  .panel-top {
    display: flex;
    align-items: flex-start;
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

  .score-num-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px;
    margin-top: 6px;
  }

  .score-num {
    font-family: var(--font-mono);
    font-size: 32px;
    font-weight: 700;
    line-height: 1.1;
    letter-spacing: -0.03em;
    color: var(--ink);
  }

  .score-num[data-tone="ok"] { color: var(--ok-ink); }
  .score-num[data-tone="warn"] { color: var(--warn-ink); }
  .score-num[data-tone="err"] { color: var(--err-ink); }

  .score-max {
    color: var(--mute);
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
  }

  .score-pill,
  .type-pill {
    display: inline-flex;
    align-items: center;
    padding: 2px 9px;
    border-radius: var(--r-pill);
    border: 1px solid var(--info-line);
    background: var(--info-bg);
    color: var(--info-ink);
    font-size: var(--fs-xs);
    font-weight: 600;
    white-space: nowrap;
  }

  .score-pill[data-tone="ok"] {
    border-color: var(--ok-line);
    background: var(--ok-bg);
    color: var(--ok-ink);
  }

  .score-pill[data-tone="warn"] {
    border-color: var(--warn-line);
    background: var(--warn-bg);
    color: var(--warn-ink);
  }

  .score-pill[data-tone="err"] {
    border-color: var(--err-line);
    background: var(--err-bg);
    color: var(--err-ink);
  }

  .score-pill.is-brand {
    border-color: var(--pick-line);
    background: var(--brand-soft);
    color: var(--brand);
  }

  .score-time {
    color: var(--mute);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }

  .score-bar {
    height: 8px;
    margin-top: 14px;
    border-radius: var(--r-pill);
    background: var(--surface2);
    overflow: hidden;
  }

  .score-bar-fill {
    height: 100%;
    border-radius: var(--r-pill);
    background: var(--mute);
    transition: width 0.35s ease;
  }

  .score-bar-fill[data-tone="ok"] { background: var(--ok-ink); }
  .score-bar-fill[data-tone="warn"] { background: var(--warn-ink); }
  .score-bar-fill[data-tone="err"] { background: var(--err-ink); }

  .ip-meta-grid {
    display: grid;
    gap: 6px;
    margin: 14px 0 0;
  }

  .ip-meta-grid > div {
    display: grid;
    grid-template-columns: 76px minmax(0, 1fr);
    gap: 10px;
    align-items: baseline;
  }

  .ip-meta-grid dt {
    color: var(--mute);
    font-size: var(--fs-xs);
  }

  .ip-meta-grid dd {
    margin: 0;
    color: var(--ink);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    line-height: 1.45;
    word-break: break-word;
  }

  .tag-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 12px;
  }

  .mini-tag {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--r-pill);
    border: 1px solid var(--info-line);
    background: var(--info-bg);
    color: var(--info-ink);
    font-size: var(--fs-2xs);
    font-weight: 600;
  }

  .mini-tag[data-tone="ok"] {
    border-color: var(--ok-line);
    background: var(--ok-bg);
    color: var(--ok-ink);
  }

  .mini-tag[data-tone="warn"] {
    border-color: var(--warn-line);
    background: var(--warn-bg);
    color: var(--warn-ink);
  }

  .mini-tag[data-tone="err"] {
    border-color: var(--err-line);
    background: var(--err-bg);
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

  .trace-fold {
    margin-top: 14px;
    padding: 0;
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
    transition: transform 0.2s ease;
  }

  .trace-fold[open] :global(.trace-chevron) {
    transform: rotate(180deg);
  }

  .trace-body {
    padding: 0 16px 16px;
    border-top: 1px solid var(--line);
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
    border: 1px solid var(--line-strong);
    border-radius: var(--r-md);
    background: var(--surface);
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

  .check-section {
    margin-top: 28px;
  }

  .section-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
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
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--ink2);
  }

  .signal-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
    transition: opacity 0.2s ease;
  }

  .signal-grid.is-scanning {
    opacity: 0.65;
  }

  .signal-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px;
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  .signal-card.is-wide {
    grid-column: 1 / -1;
  }

  .signal-card[data-tone="err"] {
    border-color: color-mix(in srgb, var(--err-ink) 38%, var(--line));
  }

  .signal-card[data-tone="warn"] {
    border-color: color-mix(in srgb, var(--warn-ink) 32%, var(--line));
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
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--surface2);
    color: var(--brand);
  }

  .signal-icon[data-tone="ok"] {
    border-color: var(--ok-line);
    background: var(--ok-bg);
    color: var(--ok-ink);
  }

  .signal-icon[data-tone="warn"] {
    border-color: var(--warn-line);
    background: var(--warn-bg);
    color: var(--warn-ink);
  }

  .signal-icon[data-tone="err"] {
    border-color: var(--err-line);
    background: var(--err-bg);
    color: var(--err-ink);
  }

  .signal-title-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding-top: 3px;
  }

  .signal-title-row h3 {
    margin: 0;
    color: var(--ink);
    font-size: var(--fs-md);
    font-weight: 600;
    line-height: 1.35;
  }

  .signal-weight,
  .signal-badge {
    display: inline-flex;
    align-items: center;
    padding: 1px 7px;
    border-radius: var(--r-pill);
    font-size: var(--fs-2xs);
    font-weight: 600;
    line-height: 1.6;
  }

  .signal-weight {
    border: 1px solid var(--line);
    background: var(--surface2);
    color: var(--mute);
  }

  .signal-badge {
    border: 1px solid var(--pick-line);
    background: var(--brand-soft);
    color: var(--brand);
  }

  .signal-badge.is-accent {
    border-color: var(--warn-line);
    background: var(--warn-bg);
    color: var(--warn-ink);
  }

  .card-value-bar {
    padding: 7px 10px;
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--surface2);
    color: var(--ink);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    line-height: 1.5;
    word-break: break-word;
  }

  .signal-detail {
    margin: 0;
    color: var(--ink2);
    font-size: var(--fs-sm);
    line-height: 1.55;
  }

  .signal-delta {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    min-width: 42px;
    padding: 2px 8px;
    border-radius: var(--r-pill);
    border: 1px solid var(--info-line);
    background: var(--info-bg);
    color: var(--info-ink);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-weight: 700;
    white-space: nowrap;
  }

  .signal-delta[data-tone="ok"] {
    border-color: var(--ok-line);
    background: var(--ok-bg);
    color: var(--ok-ink);
  }

  .signal-delta[data-tone="warn"] {
    border-color: var(--warn-line);
    background: var(--warn-bg);
    color: var(--warn-ink);
  }

  .signal-delta[data-tone="err"] {
    border-color: var(--err-line);
    background: var(--err-bg);
    color: var(--err-ink);
  }

  .target-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .target-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 9px;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: var(--surface2);
    font-size: var(--fs-xs);
    line-height: 1.4;
  }

  .target-dot {
    width: 7px;
    height: 7px;
    border-radius: var(--r-pill);
    background: var(--mute);
  }

  .target-chip[data-ok="yes"] .target-dot { background: var(--ok-ink); }
  .target-chip[data-ok="no"] .target-dot { background: var(--err-ink); }

  .target-host {
    color: var(--ink);
    font-family: var(--font-mono);
  }

  .target-rtt {
    color: var(--mute);
    font-family: var(--font-mono);
  }

  .dns-note {
    margin-top: 12px;
    padding: 14px 16px;
  }

  .dns-note-head {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--ink);
    font-size: var(--fs-sm);
  }

  .dns-note-head :global(svg) {
    color: var(--warn-ink);
    flex-shrink: 0;
  }

  .dns-note p {
    margin: 6px 0 0;
    color: var(--ink2);
    font-size: var(--fs-sm);
    line-height: 1.6;
  }

  .fix-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .fix-grid.is-single {
    grid-template-columns: minmax(0, 1fr);
  }

  .fix-card {
    padding: 15px 17px;
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  .fix-card[data-tone="err"] {
    border-color: color-mix(in srgb, var(--err-ink) 40%, var(--line));
  }

  .fix-card[data-tone="warn"] {
    border-color: color-mix(in srgb, var(--warn-ink) 35%, var(--line));
  }

  .fix-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .fix-num {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--brand);
  }

  .fix-num[data-tone="err"] {
    color: var(--err-ink);
  }

  .fix-num[data-tone="warn"] {
    color: var(--warn-ink);
  }

  .fix-head h3 {
    margin: 0;
    color: var(--ink);
    font-size: var(--fs-md);
    font-weight: 600;
    line-height: 1.35;
  }

  .fix-tag {
    margin-left: auto;
    padding: 1px 8px;
    border-radius: var(--r-pill);
    border: 1px solid var(--warn-line);
    background: var(--warn-bg);
    color: var(--warn-ink);
    font-size: var(--fs-2xs);
    font-weight: 600;
    white-space: nowrap;
  }

  .fix-tag[data-tone="err"] {
    border-color: var(--err-line);
    background: var(--err-bg);
    color: var(--err-ink);
  }

  .fix-card p {
    margin: 8px 0 0;
    color: var(--ink2);
    font-size: var(--fs-sm);
    line-height: 1.6;
  }

  @media (max-width: 860px) {
    .ready-grid,
    .dual-board,
    .signal-grid,
    .fix-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .check-ask-menu {
      right: auto;
      left: 0;
    }
  }
</style>
