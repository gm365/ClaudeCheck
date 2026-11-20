<script>
  import { onMount } from "svelte";
  import { Moon, ShieldCheck, Sun } from "lucide-svelte";
  import EnvCheck from "./lib/EnvCheck.svelte";

  let theme = $state("light");

  onMount(() => {
    theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
  });

  function toggleTheme() {
    theme = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("cc-theme", theme);
    } catch {}
  }
</script>

<div class="app-wrap">
  <header class="top-bar">
    <div class="shell top-bar-inner">
      <a class="brand" href="/">
        <span class="brand-mark" aria-hidden="true"><ShieldCheck size={16} /></span>
        <span class="brand-name">ClaudeCheck</span>
      </a>

      <button
        type="button"
        class="theme-btn"
        onclick={toggleTheme}
        aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
        title="切换浅色 / 深色模式"
      >
        {#if theme === "dark"}
          <Sun size={16} aria-hidden="true" />
        {:else}
          <Moon size={16} aria-hidden="true" />
        {/if}
      </button>
    </div>
  </header>

  <main class="shell main-content">
    <EnvCheck />
  </main>

  <footer class="site-footer">
    <div class="shell footer-inner">
      <span>ClaudeCheck · Open-source Claude IP & environment self-check</span>
      <span>MIT License · Self-hosted on Cloudflare Workers</span>
    </div>
  </footer>
</div>

<style>
  .app-wrap {
    display: flex;
    flex-direction: column;
    min-height: 100dvh;
  }

  .top-bar {
    border-bottom: 1px solid var(--line);
    background: var(--surface);
  }

  .top-bar-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 56px;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--ink);
    text-decoration: none;
    font-weight: 700;
    font-size: var(--fs-lg);
    letter-spacing: -0.02em;
  }

  .brand-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--r-md);
    background: var(--brand-soft);
    color: var(--brand);
  }

  .theme-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--surface2);
    color: var(--ink2);
    cursor: pointer;
    transition: border-color 0.15s ease, color 0.15s ease;
  }

  .theme-btn:hover {
    border-color: var(--brand);
    color: var(--brand);
  }

  .main-content {
    flex: 1;
    padding-top: 28px;
    padding-bottom: 32px;
  }

  .site-footer {
    border-top: 1px solid var(--line);
    padding: 18px 0;
  }

  .footer-inner {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px;
    color: var(--mute);
    font-size: var(--fs-xs);
  }
</style>
