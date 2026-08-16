import { useState } from "react";
import { ArrowUp, Bot, RotateCcw, Sparkles, User } from "lucide-react";

import { api } from "../api";

interface ChatMessage {
  role: "user" | "bot";
  text: string;
}

const suggestions = [
  "Produk Soysu apa yang paling laris?",
  "Cek stok Soysu Matcha",
  "Tambahkan 2 Soysu Original Less Sugar ke cart",
  "Hitung ongkir ke Sleman",
];

export default function AssistantPlayground() {
  const [conversationId, setConversationId] = useState(
    () => `playground:admin:${crypto.randomUUID()}`,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const send = async (text = input) => {
    const prompt = text.trim();
    if (!prompt || loading) return;
    setInput("");
    setError("");
    setMessages((current) => [...current, { role: "user", text: prompt }]);
    setLoading(true);
    try {
      const response = await api.post<{ text: string }>("/api/playground/chat", {
        conversationId,
        text: prompt,
      });
      setMessages((current) => [...current, { role: "bot", text: response.text }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Assistant tidak dapat merespons.");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setConversationId(`playground:admin:${crypto.randomUUID()}`);
    setMessages([]);
    setInput("");
    setError("");
  };

  return (
    <section className="assistant-page">
      <header className="assistant-header">
        <div>
          <p className="eyebrow">Soysu AI / Playground</p>
          <h2>How can I help you today?</h2>
        </div>
        <button className="button button--light" onClick={reset}>
          <RotateCcw size={14} /> New chat
        </button>
      </header>
      <div className="assistant-content">
        {!messages.length ? (
          <div className="assistant-welcome">
            <div className="assistant-mark">
              <Sparkles size={22} />
            </div>
            <h3>Soysu Assistant</h3>
            <p>
              Test the same assistant that powers WhatsApp. Ask about products, stock, carts,
              delivery, and orders.
            </p>
            <div className="suggestion-grid">
              {suggestions.map((suggestion) => (
                <button key={suggestion} onClick={() => void send(suggestion)}>
                  {suggestion}
                  <ArrowUp size={14} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="assistant-thread">
            {messages.map((message, index) => (
              <div
                className={`assistant-message assistant-message--${message.role}`}
                key={`${message.role}-${index}`}
              >
                <div className="message-avatar">
                  {message.role === "bot" ? <Bot size={15} /> : <User size={15} />}
                </div>
                <div>
                  <span>{message.role === "bot" ? "Soysu Assistant" : "You"}</span>
                  <p>{message.text}</p>
                </div>
              </div>
            ))}
            {loading && (
              <div className="assistant-message assistant-message--bot">
                <div className="message-avatar">
                  <Bot size={15} />
                </div>
                <div>
                  <span>Soysu Assistant</span>
                  <p className="assistant-typing">Thinking...</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="assistant-composer-wrap">
        {error && <p className="assistant-error">{error}</p>}
        <form
          className="assistant-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Message Soysu Assistant..."
            rows={1}
            disabled={loading}
          />
          <button aria-label="Send message" disabled={loading || !input.trim()}>
            <ArrowUp size={17} />
          </button>
        </form>
        <small>Assistant can use live product, cart, delivery, and order data.</small>
      </div>
    </section>
  );
}
