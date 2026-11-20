export const AI_TARGETS = [
  { id: "chatgpt", label: "ChatGPT", url: (q) => `https://chatgpt.com/?q=${encodeURIComponent(q)}`, fill: true, max: 7000, home: "https://chatgpt.com/" },
  { id: "claude", label: "Claude", url: (q) => `https://claude.ai/new?q=${encodeURIComponent(q)}`, fill: true, max: 7000, home: "https://claude.ai/new" },
  { id: "grok", label: "Grok", url: (q) => `https://grok.com/?q=${encodeURIComponent(q)}`, fill: true, max: 4000, home: "https://grok.com/" },
  { id: "deepseek", label: "DeepSeek", url: () => "https://chat.deepseek.com/", fill: false },
  { id: "kimi", label: "Kimi", url: () => "https://www.kimi.com/", fill: false },
  { id: "doubao", label: "豆包", url: () => "https://www.doubao.com/chat/", fill: false },
];
