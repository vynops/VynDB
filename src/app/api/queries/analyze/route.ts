import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getSettings } from '@/lib/settings-store'
import { recordUsage } from '@/lib/copilot-usage'
import Groq from 'groq-sdk'

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const { query, engine } = await req.json() as { query: string; engine: string }

  const settings = getSettings()
  const apiKey = settings.groqApiKey || process.env.GROQ_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Groq API key not configured. Set it in Settings → AI Copilot.' }, { status: 400 })
  }

  const groq = new Groq({ apiKey })
  const prompt = `You are a senior DBA. Analyze this ${engine} query and provide optimization advice.

Query:
\`\`\`
${query}
\`\`\`

Respond ONLY with this JSON (no markdown):
{
  "explanation": "What this query does and why it may be slow",
  "bottleneck": "Primary bottleneck in one sentence",
  "suggestions": ["optimization 1", "optimization 2", "optimization 3"],
  "estimatedGain": "e.g. '70-90% faster with index'",
  "indexSuggestions": ["CREATE INDEX ... if applicable"],
  "confidence": 85
}`

  try {
    const completion = await groq.chat.completions.create({
      model: settings.aiModel || 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 1024,
    })
    const raw = completion.choices[0]?.message?.content ?? '{}'
    recordUsage(completion.usage?.prompt_tokens ?? 0, completion.usage?.completion_tokens ?? 0, settings.aiModel || 'llama-3.3-70b-versatile')

    let result
    try { result = JSON.parse(raw) } catch {
      const match = raw.match(/\{[\s\S]*\}/)
      result = match ? JSON.parse(match[0]) : { explanation: raw, bottleneck: 'See explanation', suggestions: [], estimatedGain: 'Unknown', indexSuggestions: [], confidence: 50 }
    }
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
