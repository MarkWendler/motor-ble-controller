import { useState, useRef, useEffect } from 'react';
import { ChevronUp, Trash2, Copy } from 'lucide-react';

export interface DebugMessage {
  id: string;
  timestamp: number;
  type: 'sent' | 'received';
  data: string;
  raw?: Uint8Array;
}

interface DebugConsoleProps {
  messages: DebugMessage[];
  onClear?: () => void;
}

/**
 * DebugConsole Component
 * 
 * Displays BLE SPP messages (sent and received) for debugging purposes.
 * Can be toggled open/closed with a small button.
 */
export function DebugConsole({ messages, onClear }: DebugConsoleProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, autoScroll]);

  // Detect manual scroll
  const handleScroll = () => {
    if (scrollContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
      setAutoScroll(isAtBottom);
    }
  };

  // Copy all messages to clipboard
  const copyToClipboard = () => {
    const text = messages
      .map((msg) => `[${new Date(msg.timestamp).toLocaleTimeString()}] ${msg.type.toUpperCase()}: ${msg.data}`)
      .join('\n');
    navigator.clipboard.writeText(text);
  };

  return (
    <>
      {/* Debug Console Panel */}
      {isOpen && (
        <div className="fixed bottom-0 left-0 right-0 bg-gray-900 text-gray-100 border-t border-gray-700 shadow-lg z-40">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">BLE Debug Console</span>
              <span className="text-xs text-gray-400">({messages.length} messages)</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={copyToClipboard}
                className="p-1 hover:bg-gray-700 rounded text-gray-300 hover:text-white transition-colors"
                title="Copy all messages"
              >
                <Copy className="w-4 h-4" />
              </button>
              <button
                onClick={onClear}
                className="p-1 hover:bg-gray-700 rounded text-gray-300 hover:text-white transition-colors"
                title="Clear messages"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-gray-700 rounded text-gray-300 hover:text-white transition-colors"
                title="Close console"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Messages Container */}
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="h-48 overflow-y-auto font-mono text-xs bg-gray-900"
          >
            {messages.length === 0 ? (
              <div className="p-4 text-gray-500 text-center">No messages yet...</div>
            ) : (
              <div className="p-2">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`py-1 px-2 rounded ${
                      msg.type === 'sent'
                        ? 'text-blue-300 bg-blue-900/20'
                        : 'text-green-300 bg-green-900/20'
                    }`}
                  >
                    <span className="text-gray-500">[{new Date(msg.timestamp).toLocaleTimeString()}]</span>
                    {' '}
                    <span className="font-semibold">
                      {msg.type === 'sent' ? '→ SENT' : '← RECV'}
                    </span>
                    {': '}
                    <span className="break-words">{msg.data}</span>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 bg-gray-800 border-t border-gray-700 text-xs text-gray-400">
            Auto-scroll: {autoScroll ? 'ON' : 'OFF'}
          </div>
        </div>
      )}

      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-4 right-4 w-8 h-8 rounded-full flex items-center justify-center transition-all z-30 ${
          isOpen
            ? 'bg-gray-700 text-gray-200 hover:bg-gray-600'
            : 'bg-gray-600 text-gray-300 hover:bg-gray-500 opacity-50 hover:opacity-75'
        }`}
        title={isOpen ? 'Close debug console' : 'Open debug console'}
      >
        <span className="text-xs font-bold">DBG</span>
      </button>
    </>
  );
}
