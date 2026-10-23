function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function shuffle(items) {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i)
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function clampNumber(value, fallback, min, max) {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function chooseTemplate(subject, topic) {
  const s = String(subject || '').toLowerCase()
  const t = String(topic || '').toLowerCase()
  const haystack = `${s} ${t}`

  if (/math|algebra|geometry|arithmetic|equation|number/.test(haystack)) {
    return [
      {
        kind: 'math',
        difficulty: 'medium',
        prompt: ({ n1, n2 }) => `Simplify the expression: ${n1} + ${n2} × ${n1}`,
        answer: ({ n1, n2 }) => n1 + (n2 * n1),
        options: ({ n1, n2 }) => {
          const value = n1 + (n2 * n1)
          return shuffle([
            value,
            value + randomInt(2, 9),
            value - randomInt(2, 7),
            value + randomInt(10, 20),
          ])
        },
        explanation: ({ n1, n2 }) => `First, multiply ${n2} by ${n1}, then add ${n1}. The expression becomes ${n1} + ${n2 * n1} = ${n1 + (n2 * n1)}.`
      },
      {
        kind: 'math',
        difficulty: 'medium',
        prompt: ({ n1, n2 }) => `Solve for x: ${n1}x + ${n2} = ${n1 * 3 + n2}`,
        answer: ({ n1, n2 }) => 3,
        options: ({ n1, n2 }) => shuffle([3, 2, 5, 7]),
        explanation: ({ n1, n2 }) => `Subtract ${n2} from both sides: ${n1}x = ${n1 * 3}. Divide both sides by ${n1} to get x = 3.`
      },
    ]
  }

  if (/science|chemistry|biology|physics|environment/.test(haystack)) {
    return [
      {
        kind: 'science',
        difficulty: 'easy',
        prompt: ({ n1 }) => `Which of the following is the correct unit for force?`,
        answer: () => 'Newton',
        options: () => shuffle(['Newton', 'Joule', 'Watt', 'Pascal']),
        explanation: () => 'Force is measured in newtons, which is the SI unit of force.'
      },
      {
        kind: 'science',
        difficulty: 'easy',
        prompt: () => 'Which organ is mainly responsible for pumping blood around the body?',
        answer: () => 'Heart',
        options: () => shuffle(['Heart', 'Lungs', 'Liver', 'Kidney']),
        explanation: () => 'The heart is the muscular organ that pumps blood through the circulatory system.'
      },
    ]
  }

  return [
    {
      kind: 'general',
      difficulty: 'easy',
      prompt: ({ n1 }) => `Which option best completes the statement: ${n1} is a key part of learning and revision?`,
      answer: () => 'Practice',
      options: () => shuffle(['Practice', 'Irregularity', 'Silence', 'Confusion']),
      explanation: () => 'Regular practice is essential to improve understanding and performance in any subject.'
    },
    {
      kind: 'general',
      difficulty: 'medium',
      prompt: ({ n1 }) => `A student who studies consistently is most likely to:`,
      answer: () => 'Improve gradually',
      options: () => shuffle(['Improve gradually', 'Forget everything', 'Avoid revision', 'Work only at the end'],),
      explanation: () => 'Consistent study improves understanding over time and helps students build confidence.'
    },
  ]
}

export function generateLocalQuestionSet(spec = {}, count = 10) {
  const requested = clampNumber(count, 10, 1, 200)
  const subject = String(spec.subject || 'General').trim() || 'General'
  const topic = String(spec.topic || subject).trim() || subject
  const classLevel = String(spec.classLevel || 'Secondary').trim() || 'Secondary'
  const difficulty = String(spec.difficulty || 'mixed').trim() || 'mixed'
  const templates = chooseTemplate(subject, topic)

  const questions = []
  for (let i = 0; i < requested; i += 1) {
    const template = templates[i % templates.length]
    const n1 = randomInt(2, 12)
    const n2 = randomInt(2, 9)
    const values = { n1, n2, classLevel, difficulty, subject, topic }

    const correct = typeof template.answer === 'function' ? template.answer(values) : template.answer
    const choices = typeof template.options === 'function' ? template.options(values) : template.options
    let options = Array.isArray(choices) ? choices.map(String) : ['Option A', 'Option B', 'Option C', 'Option D']
    if (!options.length) options = ['Option A', 'Option B', 'Option C', 'Option D']
    while (options.length < 4) options.push(`Option ${options.length + 1}`)
    if (options.length > 4) options = options.slice(0, 4)

    const correctText = String(correct)
    const correctIndex = options.findIndex((opt) => String(opt).trim() === correctText)
    const safeOptions = options.length < 4 ? [...options, 'Option D', 'Option C', 'Option A'].slice(0, 4) : options
    const finalCorrect = String(correctText || safeOptions[0])
    const finalOptions = safeOptions.map((opt) => String(opt))
    const answerIndex = finalOptions.findIndex((opt) => String(opt).trim() === finalCorrect)
    const prompt = typeof template.prompt === 'function' ? template.prompt(values) : template.prompt
    const explanation = typeof template.explanation === 'function' ? template.explanation(values) : (template.explanation || 'This is the correct answer based on the required concept.')

    questions.push({
      prompt: String(prompt),
      options: finalOptions,
      answer: answerIndex >= 0 ? answerIndex : 0,
      subject: subject,
      topic: topic,
      difficulty: difficulty === 'mixed' ? template.difficulty || 'medium' : difficulty,
      explanation: String(explanation),
      source: 'local-template-fallback',
    })
  }

  return questions
}

export function generateLocalSvgFigure({ subject = 'General', prompt = '', style = 'pencil' } = {}) {
  const safeSubject = String(subject || 'General').trim() || 'General'
  const safePrompt = String(prompt || 'Diagram').trim() || 'Diagram'
  const accent = style === 'clean' ? '#1d4ed8' : '#7c3aed'
  const fill = style === 'clean' ? '#eff6ff' : '#f5f3ff'
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="img" aria-label="${safePrompt}">
      <rect width="640" height="360" rx="18" fill="#ffffff"/>
      <rect x="18" y="18" width="604" height="324" rx="14" fill="${fill}" stroke="${accent}" stroke-width="2"/>
      <text x="320" y="52" font-size="22" font-family="Arial, sans-serif" text-anchor="middle" fill="#1f2937" font-weight="700">${safeSubject}</text>
      <g stroke="${accent}" stroke-width="3" fill="none" opacity="0.92">
        <path d="M70 240 L220 240 L220 150 L300 150 L300 240 L520 240"/>
        <path d="M110 100 L210 100 L210 260" stroke-dasharray="8 8"/>
        <circle cx="150" cy="135" r="30" fill="rgba(124,58,237,0.15)" stroke="${accent}"/>
        <circle cx="430" cy="135" r="38" fill="rgba(29,78,216,0.12)" stroke="${accent}"/>
      </g>
      <g font-family="Arial, sans-serif" fill="#1f2937">
        <text x="320" y="292" font-size="24" text-anchor="middle">${safePrompt.slice(0, 32)}</text>
        <text x="320" y="314" font-size="16" text-anchor="middle" fill="#4b5563">Local fallback diagram</text>
      </g>
    </svg>
  `

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
