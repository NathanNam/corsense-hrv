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

/** Simple markdown-ish renderer for Newton's responses */
function renderNewtonText(text: string) {
  // Split into paragraphs by double newline
  const paragraphs = text.split(/\n\n+/);

  return paragraphs.map((para, pi) => {
    // Check if this is a numbered list item (e.g. "1. **Title**: ...")
    const lines = para.split('\n');
    const isListBlock = lines.every(
      (l) => /^\d+\.\s/.test(l.trim()) || l.trim() === '',
    );

    if (isListBlock && lines.filter((l) => l.trim()).length > 1) {
      return (
        <ol key={pi} className="list-decimal list-outside ml-4 space-y-1.5 my-2">
          {lines
            .filter((l) => l.trim())
            .map((line, li) => (
              <li key={li} className="text-sm text-gray-700 leading-relaxed">
                {renderInline(line.replace(/^\d+\.\s*/, ''))}
              </li>
            ))}
        </ol>
      );
    }

    // Check for bullet list
    const isBulletBlock = lines.every(
      (l) => /^[-*]\s/.test(l.trim()) || l.trim() === '',
    );

    if (isBulletBlock && lines.filter((l) => l.trim()).length > 1) {
      return (
        <ul key={pi} className="list-disc list-outside ml-4 space-y-1 my-2">
          {lines
            .filter((l) => l.trim())
            .map((line, li) => (
              <li key={li} className="text-sm text-gray-700 leading-relaxed">
                {renderInline(line.replace(/^[-*]\s*/, ''))}
              </li>
            ))}
        </ul>
      );
    }

    return (
      <p key={pi} className="text-sm text-gray-700 leading-relaxed my-1.5">
        {renderInline(para.replace(/\n/g, ' '))}
      </p>
    );
  });
}

/** Render inline markdown: **bold** */
function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-semibold text-gray-900">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

export function NewtonChat({ messages, loading, rrCount, onAsk }: NewtonChatProps) {
  const lowData = rrCount < MIN_RR_FOR_GOOD_ANALYSIS;
  const [input, setInput] = useState('');
  const [collapsed, setCollapsed] = useState(false);
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

  const hasUnread = collapsed && messages.length > 0;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col overflow-hidden">
      {/* Header banner — clickable to toggle */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-3 flex items-center justify-between w-full text-left cursor-pointer hover:from-blue-700 hover:to-blue-600 transition-colors"
      >
        <div>
          <h2 className="text-base font-bold text-white">
            Newton AI
            {hasUnread && (
              <span className="ml-2 inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold bg-white text-blue-600 rounded-full">
                {messages.filter((m) => m.role === 'newton').length}
              </span>
            )}
          </h2>
          {!collapsed && (
            <p className="text-xs text-blue-100 mt-0.5">
              Ask about your stress, recovery, and heart rate patterns.
            </p>
          )}
        </div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`w-5 h-5 text-white/70 transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`}
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {!collapsed && (
        <>
          {lowData && (
            <div className="mx-4 mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
              Building charts... Newton analyzes your chart screenshots, so let the data build up for 1+ minutes before asking.
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 max-h-[400px] min-h-[100px]">
            {/* Welcome message */}
            {messages.length === 0 && !loading && (
              <div className="flex items-start gap-2.5">
                <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center shrink-0 mt-0.5">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="white" className="w-3.5 h-3.5">
                    <path d="M10 1a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 1zM5.05 3.05a.75.75 0 011.06 0l1.062 1.06A.75.75 0 116.11 5.173L5.05 4.11a.75.75 0 010-1.06zm9.9 0a.75.75 0 010 1.06l-1.06 1.062a.75.75 0 01-1.062-1.061l1.061-1.06a.75.75 0 011.06 0zM10 7a3 3 0 100 6 3 3 0 000-6zm-6.25 3a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5H3a.75.75 0 01.75.75zm14 0a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5H17a.75.75 0 01.75.75zm-11.89 5.83a.75.75 0 011.06-1.06l1.06 1.06a.75.75 0 01-1.06 1.06l-1.06-1.06zm8.78 0a.75.75 0 010 1.06l-1.06 1.061a.75.75 0 11-1.06-1.06l1.06-1.06a.75.75 0 011.06 0z" />
                  </svg>
                </div>
                <div className="bg-gray-50 border border-gray-100 rounded-2xl rounded-tl-sm px-3.5 py-2.5">
                  <p className="text-sm text-gray-700">What would you like to know about your HRV data?</p>
                </div>
              </div>
            )}

            {messages.map((msg, i) =>
              msg.role === 'user' ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-blue-500 px-3.5 py-2.5">
                    <p className="text-sm text-white">{msg.text}</p>
                  </div>
                </div>
              ) : (
                <div key={i} className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center shrink-0 mt-0.5">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="white" className="w-3.5 h-3.5">
                      <path d="M10 1a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 1zM5.05 3.05a.75.75 0 011.06 0l1.062 1.06A.75.75 0 116.11 5.173L5.05 4.11a.75.75 0 010-1.06zm9.9 0a.75.75 0 010 1.06l-1.06 1.062a.75.75 0 01-1.061-1.061l1.06-1.06a.75.75 0 011.06 0zM10 7a3 3 0 100 6 3 3 0 000-6zm-6.25 3a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5H3a.75.75 0 01.75.75zm14 0a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5H17a.75.75 0 01.75.75zm-11.89 5.83a.75.75 0 011.06-1.06l1.06 1.06a.75.75 0 01-1.06 1.06l-1.06-1.06zm8.78 0a.75.75 0 010 1.06l-1.06 1.061a.75.75 0 11-1.06-1.06l1.06-1.06a.75.75 0 011.06 0z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0 bg-gray-50 border border-gray-100 rounded-2xl rounded-tl-sm px-3.5 py-2.5">
                    {renderNewtonText(msg.text)}
                  </div>
                </div>
              ),
            )}

            {loading && (
              <div className="flex items-start gap-2.5">
                <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center shrink-0 mt-0.5">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="white" className="w-3.5 h-3.5">
                    <path d="M10 1a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 1zM5.05 3.05a.75.75 0 011.06 0l1.062 1.06A.75.75 0 116.11 5.173L5.05 4.11a.75.75 0 010-1.06zm9.9 0a.75.75 0 010 1.06l-1.06 1.062a.75.75 0 01-1.061-1.061l1.06-1.06a.75.75 0 011.06 0zM10 7a3 3 0 100 6 3 3 0 000-6zm-6.25 3a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5H3a.75.75 0 01.75.75zm14 0a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5H17a.75.75 0 01.75.75zm-11.89 5.83a.75.75 0 011.06-1.06l1.06 1.06a.75.75 0 01-1.06 1.06l-1.06-1.06zm8.78 0a.75.75 0 010 1.06l-1.06 1.061a.75.75 0 11-1.06-1.06l1.06-1.06a.75.75 0 011.06 0z" />
                  </svg>
                </div>
                <div className="bg-gray-50 border border-gray-100 rounded-2xl rounded-tl-sm px-3.5 py-2.5">
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
                    Analyzing your charts...
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Suggested questions */}
          {messages.length === 0 && !loading && (
            <div className="px-4 pb-2 flex flex-wrap gap-2">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => onAsk(q)}
                  disabled={loading}
                  className="text-xs px-3 py-1.5 rounded-full border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <form onSubmit={handleSubmit} className="px-4 py-3 border-t border-gray-100 flex gap-2 items-center">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your HRV..."
              disabled={loading}
              className="flex-1 text-sm border border-gray-200 rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="w-9 h-9 flex items-center justify-center bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
              </svg>
            </button>
          </form>
        </>
      )}
    </div>
  );
}
