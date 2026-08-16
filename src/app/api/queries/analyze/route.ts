import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getSettings } from '@/lib/settings-store'
import { recordUsage } from '@/lib/copilot-usage'

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const { query, engine } = await req.json() as { query: string; engine: string }

  const settings = getSettings()
  const provider = settings.aiProvider || 'groq'
  const apiKey = settings.aiApiKey || (provider === 'groq' ? settings.groqApiKey || process.env.GROQ_API_KEY : '')
  if (!apiKey) {
    return NextResponse.json({ error: `${provider} API key not configured. Set it in Settings → AI Copilot.` }, { status: 400 })
  }

  const prompt = `You are VynDB Query Intelligence, analyzing a ${engine} query. Use only evidence available in the query and clearly label assumptions.

Query:
\`\`\`
${query}
\`\`\`

Rules:
- Use ${engine}-specific syntax and optimizer concepts.
- Do not claim an index, plan, permission, or performance gain is verified without an execution plan or measured before/after data.
- Distinguish observed evidence, hypothesis, risk, and verification steps.
- Never recommend destructive SQL as an automatic action.

Respond ONLY with this JSON (no markdown):
{
  "explanation": "What this query does and why it may be slow",
  "bottleneck": "Primary bottleneck in one sentence",
  "suggestions": ["optimization 1", "optimization 2", "optimization 3"],
  "estimatedGain": "e.g. '70-90% faster with index'",
  "indexSuggestions": ["CREATE INDEX ... if applicable"],
  "confidence": 85,
  "evidence": ["Observed fact or explicitly stated limitation"],
  "risks": ["Write overhead, lock risk, compatibility risk, or 'none identified'"],
  "verification": ["Exact EXPLAIN/measurement to run after a change"]
}`

  try {
    const model = settings.aiModel || 'llama-3.3-70b-versatile'
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
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 1024 }) })
      if (!response.ok) throw new Error(`${provider} API error: ${response.status} ${response.statusText}`)
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
      raw = data.choices?.[0]?.message?.content ?? '{}'
      promptTokens = data.usage?.prompt_tokens ?? 0
      completionTokens = data.usage?.completion_tokens ?? 0
    }
    recordUsage(promptTokens, completionTokens, model, provider)

    let result
    try { result = JSON.parse(raw) } catch {
      const match = raw.match(/\{[\s\S]*\}/)
      result = match ? JSON.parse(match[0]) : { explanation: raw, bottleneck: 'See explanation', suggestions: [], estimatedGain: 'Unknown', indexSuggestions: [], confidence: 50, evidence: ['Model response was not valid JSON'], risks: ['Review manually before acting'], verification: [] }
    }
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
