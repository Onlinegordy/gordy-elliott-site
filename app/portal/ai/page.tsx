"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import AIComposerTextarea from "@/components/ui/AIComposerTextarea";
import { AI_CONTENT_REPORT_KEY } from "@/lib/ai-content-report";

interface Message {
  role: "user" | "assistant";
  content: string;
  contextPolicy?: string;
  action?: { label: string; href: string };
}

function renderMarkdown(text: string) {
  const parts = text.split(/(\[.*?\]\(.*?\))/g);
  return parts.map((part, i) => {
    const linkMatch = part.match(/\[(.*?)\]\((.*?)\)/);
    if (linkMatch) {
      return (
        <Link
          key={i}
          href={linkMatch[2]}
          className="text-accent-bright hover:underline font-medium"
        >
          {linkMatch[1]}
        </Link>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function renderContent(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    if (line.startsWith("**") && line.endsWith("**")) {
      return (
        <p key={i} className="font-semibold text-text-primary">
          {line.slice(2, -2)}
        </p>
      );
    }
    const boldParts = line.split(/(\*\*.*?\*\*)/g);
    const rendered = boldParts.map((part, j) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={j} className="font-semibold text-text-primary">{part.slice(2, -2)}</strong>;
      }
      return <span key={j}>{renderMarkdown(part)}</span>;
    });
    if (line.trim() === "") return <br key={i} />;
    if (line.startsWith("- ") || line.startsWith("* ")) {
      return (
        <li key={i} className="ml-4 list-disc text-text-secondary">
          {rendered.slice(0, 1)}
          {boldParts.length > 1 ? rendered.slice(1) : renderMarkdown(line.slice(2))}
        </li>
      );
    }
    return <p key={i}>{rendered}</p>;
  });
}

export default function ShiftAIPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [tier, setTier] = useState<string>("coached");
  const [usage, setUsage] = useState<{ limited: boolean; used: number; limit: number | null; remaining: number | null; period?: "day" | "month" } | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: loading ? "auto" : "smooth", block: "end" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, loading]);

  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) {
      inputRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    fetch("/api/portal/ai/usage")
      .then((r) => r.ok ? r.json() : null)
      .then(setUsage)
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/portal/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.tier) setTier(d.tier); })
      .catch(() => {});
  }, []);

  const quickPrompts: Record<string, string[]> = {
    coached: [
      "What should I focus on this week?",
      "Swap a meal I'm struggling with",
      "What training do I have left today?",
      "Summarise my progress this month",
    ],
    premium: [
      "What's the one thing I should tighten this week?",
      "Swap a meal I'm struggling with",
      "What training do I have left today?",
      "Draft my priority message for Gordy",
    ],
    vip: [
      "What should Gordy see first about me this week?",
      "Swap a meal I'm struggling with",
      "What training do I have left today?",
      "Give me a 3-bullet summary of my last check-in",
    ],
    ai_only: [
      "What should I focus on this week?",
      "Help me plan today's session",
      "Swap a food I'm stuck on",
      "How have I been doing recently?",
    ],
  };
  const prompts = quickPrompts[tier] || quickPrompts.coached;

  async function handleSend(override?: string) {
    const trimmed = (override || input).trim();
    if (!trimmed || loading) return;

    const userMsg: Message = { role: "user", content: trimmed };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/portal/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: messages,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.usage) setUsage(data.usage);
        setMessages([...updated, { role: "assistant", content: data.error || "Sorry, something went wrong. Please try again." }]);
        return;
      }

      const data = await res.json();
      if (data.usage) setUsage(data.usage);
      setMessages([...updated, { role: "assistant", content: data.reply, action: data.action, contextPolicy: data.contextPolicy }]);
    } catch {
      setMessages([...updated, { role: "assistant", content: "Sorry, something went wrong. Please try again." }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="shift-ai-shell mx-auto flex w-full max-w-3xl flex-col h-[calc(100dvh-10rem)] sm:h-[calc(100dvh-8rem)] lg:h-[calc(100vh-4rem)]">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl font-heading font-extrabold text-text-primary sm:text-2xl">AT CAPACITY AI</h1>
        <p className="text-sm text-text-secondary mt-1">
          Your personal coaching assistant - ask about training, your plan, or next steps.
        </p>
        {usage?.limited && usage.limit !== null && (
          <div className="mt-3 inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-text-secondary">
            {usage.remaining} of {usage.limit} {usage.period === "day" ? "AI exchanges left today · resets midnight UK time" : "replies left this month"}
          </div>
        )}
      </div>

      <div ref={threadRef} className="shift-ai-thread app-card-quiet flex-1 min-h-0 overflow-y-auto p-4 space-y-4 mb-3 rounded-[20px] sm:mb-4 sm:rounded-[24px] flex flex-col">
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-14 h-14 rounded-2xl bg-[rgba(224,64,208,0.1)] border border-[rgba(224,64,208,0.2)] flex items-center justify-center mb-4">
              <svg className="w-7 h-7 text-accent-bright" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-text-primary mb-2">How can I help?</h2>
            <p className="text-sm text-text-muted max-w-md mb-6">
              I know your training plan, nutrition plan, check-ins and goals. Ask me anything.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md">
              {prompts.map((q) => (
                <button
                  key={q}
                  onClick={() => handleSend(q)}
                  className="text-left text-sm text-text-secondary px-4 py-3 rounded-xl border border-[rgba(0,0,0,0.08)] hover:border-[rgba(224,64,208,0.2)] hover:bg-[rgba(224,64,208,0.05)] transition-all duration-200 cursor-pointer min-h-[48px]"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.length > 0 && <div className="flex-1" />}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`shift-ai-message flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-accent/20 text-text-primary rounded-br-md"
                  : "bg-[rgba(0,0,0,0.03)] text-text-secondary border border-[rgba(0,0,0,0.06)] rounded-bl-md"
              }`}
            >
              <div className="space-y-1.5">
                {msg.role === "assistant" ? renderContent(msg.content) : msg.content}
              </div>
              {msg.role === "assistant" && msg.action && (
                <Link href={msg.action.href} className="mt-3 inline-flex min-h-10 items-center rounded-xl bg-accent/15 px-4 py-2 text-sm font-semibold text-accent-bright no-underline">
                  {msg.action.label}
                </Link>
              )}
              {msg.role === "assistant" && (
                <Link href="/support/report?source=ai" className="mt-2 inline-flex min-h-10 items-center text-xs text-text-muted hover:text-text-primary"
                  onClick={() => {
                    try {
                      sessionStorage.setItem(AI_CONTENT_REPORT_KEY, JSON.stringify({ reply: msg.content.slice(0, 2500), createdAt: Date.now() }));
                    } catch { /* The form remains available if private storage is blocked. */ }
                  }}>
                  Report this reply
                </Link>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-[rgba(0,0,0,0.03)] border border-[rgba(0,0,0,0.06)] rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-accent-bright/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-2 h-2 rounded-full bg-accent-bright/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-2 h-2 rounded-full bg-accent-bright/40 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div
        className="shift-ai-composer-bar"
      >
        <div className="relative">
        <AIComposerTextarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => window.setTimeout(() => messagesEndRef.current?.scrollIntoView({ block: "end" }), 80)}
          onInput={(event) => {
            event.currentTarget.style.height = "auto";
            event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 120)}px`;
          }}
          aria-label="Ask AT CAPACITY AI"
          placeholder="Ask AT CAPACITY AI..."
          rows={1}
          disabled={loading}
        />
        <button
          type="button"
          onClick={() => handleSend()}
          disabled={!input.trim() || loading}
          aria-label={loading ? "AT CAPACITY AI is replying" : "Send message to AT CAPACITY AI"}
          title="Send message"
          className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-xl bg-accent-bright/20 hover:bg-accent-bright/30 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors cursor-pointer"
        >
          <svg className="w-4 h-4 text-accent-bright" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
          </svg>
        </button>
        </div>
      </div>
    </div>
  );
}
