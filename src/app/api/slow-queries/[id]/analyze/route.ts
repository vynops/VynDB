import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadSlowQueries, saveSlowQuery } from '@/lib/db-store'
import { getSettings } from '@/lib/settings-store'
import { recordUsage } from '@/lib/copilot-usage'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const queries = loadSlowQueries()
  const q = queries.find(x => x.id === id)
  if (!q) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const settings = getSettings()
  const provider = settings.aiProvider || 'groq'
  const apiKey = settings.aiApiKey || (provider === 'groq' ? settings.groqApiKey || process.env.GROQ_API_KEY : '')
  if (!apiKey) {
    return NextResponse.json({ error: `${provider} API key not configured. Set it in Settings → AI Copilot.` }, { status: 400 })
  }

  const model = settings.aiModel || 'llama-3.3-70b-versatile'
  const prompt = `You are VynDB Query Intelligence. Analyze this ${q.engine} query using only the evidence below.

\`\`\`sql
${q.query}
\`\`\`

Statistics:
- Duration: ${q.durationMs}ms
${q.rowsExamined ? `- Rows examined: ${q.rowsExamined.toLocaleString()}` : ''}
${q.rowsReturned ? `- Rows returned: ${q.rowsReturned?.toLocaleString()}` : ''}
- Engine: ${q.engine}

Use ${q.engine}-specific terminology. Do not claim an improvement is measured. Include risks and exact verification steps. Respond in this exact JSON format (no markdown, no extra text):
{
  "explanation": "Plain English explanation of what the query does and why it is slow",
  "bottleneck": "The main performance bottleneck in one sentence",
  "suggestions": ["suggestion 1", "suggestion 2", "suggestion 3"],
  "estimatedGain": "Estimated performance improvement e.g. '80-95% faster'",
  "indexSuggestions": ["CREATE INDEX ... statement if applicable"],
  "confidence": 88,
  "evidence": ["Observed fact or limitation"],
  "risks": ["Operational risk"],
  "verification": ["Exact before/after check"]
}`

  try {
    let raw = '{}'
    let promptTokens = 0
    let completionTokens = 0
    if (provider === 'anthropic') {
      const Anthropic = (await import('@anthropic-ai/sdk')).default
      const response = await new Anthropic({ apiKey }).messages.create({ model, max_tokens: 1024, system: 'Return only valid JSON.', messages: [{ role: 'user', content: prompt }] })
      raw = response.content[0]?.type === 'text' ? response.content[0].text : '{}'
      promptTokens = response.usage?.input_tokens ?? 0
      completionTokens = response.usage?.output_tokens ?? 0
    } else if (provider === 'google') {
      const { GoogleGenerativeAI } = await import('@google/generative-ai')
      const response = await new GoogleGenerativeAI(apiKey).getGenerativeModel({ model, systemInstruction: 'Return only valid JSON.' }).generateContent(prompt)
      raw = response.response.text()
      promptTokens = response.response.usageMetadata?.promptTokenCount ?? 0
      completionTokens = response.response.usageMetadata?.candidatesTokenCount ?? 0
    } else {
      const endpoint = provider === 'custom' ? `${(settings.aiBaseUrl || '').replace(/\/$/, '')}/chat/completions` : provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://api.groq.com/openai/v1/chat/completions'
      if (provider === 'custom' && !settings.aiBaseUrl) return NextResponse.json({ error: 'Custom AI provider requires baseUrl to be configured' }, { status: 400 })
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 1024 }) })
      if (!response.ok) throw new Error(`${provider} API error: ${response.status} ${response.statusText}`)
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
      raw = data.choices?.[0]?.message?.content ?? '{}'
      promptTokens = data.usage?.prompt_tokens ?? 0
      completionTokens = data.usage?.completion_tokens ?? 0
    }
    recordUsage(promptTokens, completionTokens, model, provider)

    let analysis
    try { analysis = JSON.parse(raw) } catch {
      // Try to extract JSON from response
      const match = raw.match(/\{[\s\S]*\}/)
      analysis = match ? JSON.parse(match[0]) : { explanation: raw, bottleneck: 'See explanation', suggestions: [], estimatedGain: 'Unknown', indexSuggestions: [], confidence: 50, evidence: ['Model response was not valid JSON'], risks: ['Review manually before acting'], verification: [] }
    }

    const updated = { ...q, analyzed: true, aiAnalysis: analysis }
    saveSlowQuery(updated)
    return NextResponse.json({ ok: true, aiAnalysis: analysis })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
