"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import AIComposerTextarea from "@/components/ui/AIComposerTextarea";

interface Message {
  role: "user" | "assistant";
  content: string;
  contextPolicy?: string;
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

export default function AdminShiftAIPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = { role: "user", content: trimmed };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/admin/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: messages,
        }),
      });

      if (!res.ok) {
        setMessages([...updated, { role: "assistant", content: "Sorry, something went wrong. Please try again." }]);
        return;
      }

      const data = await res.json();
      setMessages([...updated, { role: "assistant", content: data.reply, contextPolicy: data.contextPolicy }]);
    } catch {
      setMessages([...updated, { role: "assistant", content: "Sorry, something went wrong. Please try again." }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-heading font-extrabold text-text-primary">AT CAPACITY AI</h1>
        <p className="text-sm text-text-secondary mt-1">
          Your coaching business assistant - ask about clients, training, check-ins, or plans.
        </p>
      </div>

      <div className={`flex-1 overflow-y-auto p-4 space-y-4 mb-4 flex flex-col ${messages.length > 0 ? "justify-end" : ""}`}>
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-14 h-14 rounded-2xl bg-[rgba(224,64,208,0.1)] border border-[rgba(224,64,208,0.2)] flex items-center justify-center mb-4">
              <svg className="w-7 h-7 text-accent-bright" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-text-primary mb-2">How can I help?</h2>
            <p className="text-sm text-text-muted max-w-md mb-6">
              I know all your clients, their plans, check-ins, and training modules. Ask me anything.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md">
              {[
                "Which clients need attention this week?",
                "Summarise recent check-ins",
                "Who hasn't checked in recently?",
                "Draft a reply to the latest check-in",
                "Which clients are up to date?",
                "What training should I assign next?",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setInput(q);
                    setTimeout(() => inputRef.current?.focus(), 50);
                  }}
                  className="text-left text-xs text-text-secondary px-3 py-2.5 rounded-xl border border-[rgba(0,0,0,0.08)] hover:border-[rgba(224,64,208,0.2)] hover:bg-[rgba(224,64,208,0.05)] transition-all duration-200 cursor-pointer"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
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

      <div className="relative">
        <AIComposerTextarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask AT CAPACITY AI..."
          rows={1}
          disabled={loading}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || loading}
          className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-xl bg-accent-bright/20 hover:bg-accent-bright/30 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors cursor-pointer"
        >
          <svg className="w-4 h-4 text-accent-bright" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
