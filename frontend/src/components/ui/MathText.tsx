import { useMemo } from 'react'
import katex from 'katex'

interface Token {
  math: boolean
  value: string
  display: boolean
}

const MATH_PATTERN = /\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  const re = new RegExp(MATH_PATTERN.source, 'g')
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) tokens.push({ math: false, value: text.slice(last, m.index), display: false })
    if (m[1] !== undefined) tokens.push({ math: true, value: m[1], display: true })
    else tokens.push({ math: true, value: m[2], display: false })
    last = re.lastIndex
  }
  if (last < text.length) tokens.push({ math: false, value: text.slice(last), display: false })
  return tokens
}

export function MathText({ text, className }: { text: string; className?: string }) {
  const tokens = useMemo(() => tokenize(text || ''), [text])
  return (
    <span className={className}>
      {tokens.map((t, i) =>
        t.math ? (
          <span
            key={i}
            dangerouslySetInnerHTML={{ __html: katex.renderToString(t.value, { throwOnError: false, displayMode: t.display, output: 'htmlAndMathml' }) }}
          />
        ) : (
          <span key={i}>{t.value}</span>
        )
      )}
    </span>
  )
}
