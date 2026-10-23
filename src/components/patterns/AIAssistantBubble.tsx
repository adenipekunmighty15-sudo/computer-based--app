import { useState, useRef, useEffect } from 'react'
import { api } from '../../api'
import { Button, Icon, MathText } from '../ui'
import { useAuth } from '../../auth-context'
import { useScreenContext } from '../../lib/context'
import { useRoute } from '../../lib/router'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export function AIAssistantBubble() {
  const { user } = useAuth()
  const { context } = useScreenContext()
  const route = useRoute()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [language, setLanguage] = useState<'English' | 'Yoruba' | 'Igbo' | 'Hausa'>('English')

  useEffect(() => {
    if (messages.length === 0 && user) {
      setMessages([
        {
          role: 'assistant',
          content: `Hello ${user.name}! I'm **Brighter Tomorrow**, your AI assistant. I see you're currently on the **${context?.title || route.path}** page. How can I help you?`
        }
      ])
    }
  }, [user, messages.length, context?.title, route.path])

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    if (open) scrollToBottom()
  }, [messages, open])

  const handleSend = async (textToSend?: string) => {
    const text = textToSend || input
    if (!text.trim() || loading) return

    const newMessages: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(newMessages)
    if (!textToSend) setInput('')
    setLoading(true)

    try {
      const res = await api.aiChat({
        messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        language,
        context: {
          path: route.path,
          ...context
        }
      })
      if (res && res.text) {
        setMessages([...newMessages, { role: 'assistant', content: res.text }])
      }
    } catch (err) {
      setMessages([
        ...newMessages,
        { role: 'assistant', content: 'Sorry, I encountered an error answering your question. Please try again.' }
      ])
    } finally {
      setLoading(false)
    }
  }

  const suggestions = context?.suggestions || (user?.role === 'teacher'
    ? [
        'How do I frame a hard physics question on friction?',
        'Suggest 3 topics for a JSS2 Mathematics quiz.',
        'Explain how to grade essay answers objectively.'
      ]
    : [
        'Explain the quadratic formula step-by-step.',
        'What is the difference between mitosis and meiosis?',
        'Give me a mnemonic to remember the colors of the rainbow.'
      ])

  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999 }}>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            backgroundColor: 'var(--accent, #2563eb)',
            color: 'white',
            border: 'none',
            boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 0.2s',
          }}
          onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.05)')}
          onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
          title="Ask AI Assistant"
        >
          <Icon name="sparkle" size={24} />
        </button>
      )}

      {open && (
        <div
          style={{
            width: 380,
            height: 520,
            maxWidth: 'calc(100vw - 32px)',
            maxHeight: 'calc(100vh - 48px)',
            backgroundColor: 'var(--bg, #ffffff)',
            border: '1px solid var(--border, #e5e7eb)',
            borderRadius: 16,
            boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--border, #e5e7eb)',
              backgroundColor: 'var(--surface, #f9fafb)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  backgroundColor: 'var(--accent, #2563eb)',
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="sparkle" size={14} />
              </div>
              <strong style={{ fontSize: 14 }}>Brighter Tomorrow AI</strong>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <select
                value={language}
                onChange={e => setLanguage(e.target.value as any)}
                style={{
                  fontSize: 11,
                  padding: '2px 4px',
                  borderRadius: 6,
                  border: '1px solid var(--border, #d1d5db)',
                  backgroundColor: 'var(--bg, #ffffff)',
                  color: 'var(--fg, #111827)',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                <option value="English">English</option>
                <option value="Yoruba">Yorùbá</option>
                <option value="Igbo">Igbo</option>
                <option value="Hausa">Hausa</option>
              </select>
              <button
                onClick={() => setOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--fg-dim, #6b7280)',
                  padding: 4,
                  display: 'flex',
                }}
              >
                <Icon name="x" size={16} />
              </button>
            </div>
          </div>

          {/* Messages list */}
          <div
            style={{
              flex: 1,
              padding: 16,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {messages.map((m, i) => {
              const isAssistant = m.role === 'assistant'
              return (
                <div
                  key={i}
                  style={{
                    alignSelf: isAssistant ? 'flex-start' : 'flex-end',
                    maxWidth: '85%',
                    backgroundColor: isAssistant ? 'var(--surface-raised, #f3f4f6)' : 'var(--accent, #2563eb)',
                    color: isAssistant ? 'var(--fg, #111827)' : 'white',
                    padding: '10px 14px',
                    borderRadius: 12,
                    borderBottomLeftRadius: isAssistant ? 2 : 12,
                    borderBottomRightRadius: !isAssistant ? 2 : 12,
                    fontSize: 13,
                    lineHeight: 1.45,
                    wordBreak: 'break-word',
                  }}
                >
                  <MathText text={m.content} />
                </div>
              )
            })}
            {loading && (
              <div
                style={{
                  alignSelf: 'flex-start',
                  backgroundColor: 'var(--surface-raised, #f3f4f6)',
                  padding: '8px 12px',
                  borderRadius: 12,
                  fontSize: 12,
                  color: 'var(--fg-dim, #6b7280)',
                }}
              >
                Thinking...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Suggestions */}
          {messages.length <= 2 && (
            <div
              style={{
                padding: '4px 12px 8px',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
              }}
            >
              {suggestions.map((s, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSend(s)}
                  style={{
                    background: 'var(--surface, #f9fafb)',
                    border: '1px solid var(--border, #e5e7eb)',
                    borderRadius: 12,
                    padding: '4px 8px',
                    fontSize: 11,
                    color: 'var(--fg-dim, #4b5563)',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input field */}
          <form
            onSubmit={e => {
              e.preventDefault()
              handleSend()
            }}
            style={{
              padding: 12,
              borderTop: '1px solid var(--border, #e5e7eb)',
              display: 'flex',
              gap: 8,
              backgroundColor: 'var(--surface, #f9fafb)',
            }}
          >
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask anything..."
              disabled={loading}
              style={{
                flex: 1,
                border: '1px solid var(--border, #d1d5db)',
                borderRadius: 8,
                padding: '8px 12px',
                fontSize: 13,
                outline: 'none',
                backgroundColor: 'var(--bg, #ffffff)',
                color: 'var(--fg, #111827)',
              }}
            />
            <Button
              variant="primary"
              size="sm"
              disabled={loading || !input.trim()}
              type="submit"
            >
              Send
            </Button>
          </form>
        </div>
      )}
    </div>
  )
}
