'use client';

import { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from '../hooks/use-newton';

const SUGGESTED_QUESTIONS = [
  'Am I stressed?',
  'Should I work out today?',
  'Explain my HRV',
  'How is my recovery?',
];

const MIN_RR_FOR_GOOD_ANALYSIS = 64;

interface NewtonChatProps {
  messages: ChatMessage[];
  loading: boolean;
  rrCount: number;
  onAsk: (question: string) => void;
}

export function NewtonChat({ messages, loading, rrCount, onAsk }: NewtonChatProps) {
  const lowData = rrCount < MIN_RR_FOR_GOOD_ANALYSIS;
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    setInput('');
    onAsk(trimmed);
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col">
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-700">Ask Newton</h2>
        <p className="text-xs text-gray-400">AI-powered HRV insights</p>
      </div>

      {lowData && (
        <div className="mx-4 mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
          Collecting data... Newton works best with 1+ minutes of readings ({rrCount}/{MIN_RR_FOR_GOOD_ANALYSIS} beats).
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 max-h-[60vh] min-h-[200px]">
        {messages.length === 0 && !loading && (
          <p className="text-xs text-gray-400 text-center py-4">
            Ask a question about your HRV data
          </p>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              {msg.role === 'newton'
                ? msg.text.split(/(\*\*[^*]+\*\*)/).map((part, j) =>
                    part.startsWith('**') && part.endsWith('**') ? (
                      <strong key={j}>{part.slice(2, -2)}</strong>
                    ) : (
                      part
                    ),
                  )
                : msg.text}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-xl px-3 py-2 text-sm text-gray-500">
              <span className="inline-flex gap-1">
                <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggested questions */}
      {messages.length === 0 && (
        <div className="px-4 pb-2 flex flex-wrap gap-2">
          {SUGGESTED_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => onAsk(q)}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="px-4 py-3 border-t border-gray-100 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your HRV..."
          disabled={loading}
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="text-sm px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
