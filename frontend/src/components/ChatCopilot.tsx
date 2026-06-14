import { useRef, useState } from "react";
import { Send, Sparkles } from "lucide-react";
import { sendChat } from "../api";
import type { ChatTurn } from "../types";

interface Props {
  nodeId: string;
}

const LANGS = [
  { code: "en-IN", label: "English" },
  { code: "te-IN", label: "తెలుగు" },
  { code: "ta-IN", label: "தமிழ்" },
];

export default function ChatCopilot({ nodeId }: Props) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [lang, setLang] = useState("en-IN");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const scrollToEnd = () => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    const history = [...turns];
    const next: ChatTurn[] = [...turns, { role: "user", content: text }];
    setTurns(next);
    setInput("");
    setBusy(true);
    scrollToEnd();

    try {
      const res = await sendChat(text, history, nodeId, lang);
      setTurns([...next, { role: "assistant", content: res.response }]);
    } catch (err) {
      setTurns([
        ...next,
        {
          role: "assistant",
          content: `⚠️ Could not reach the copilot (${
            err instanceof Error ? err.message : "error"
          }).`,
        },
      ]);
    } finally {
      setBusy(false);
      scrollToEnd();
    }
  };

  return (
    <div className="chat-card">
      <div className="chat-header">
        <Sparkles size={16} />
        <h3>Flood Copilot</h3>
        <select
          className="lang-select"
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          aria-label="Response language"
        >
          {LANGS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        {turns.length === 0 && (
          <div className="chat-hint">
            Ask about flood risk, forecasts, or what to do. Try:{" "}
            <em>"Krishna river lo vasthava?"</em>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`chat-bubble ${t.role}`}>
            {t.content}
          </div>
        ))}
        {busy && <div className="chat-bubble assistant typing">…</div>}
      </div>

      <form className="chat-input" onSubmit={submit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the copilot…"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
