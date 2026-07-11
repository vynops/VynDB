import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadSlowQueries, saveSlowQuery } from '@/lib/db-store'
import { getSettings } from '@/lib/settings-store'
import { recordUsage } from '@/lib/copilot-usage'
import Groq from 'groq-sdk'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const queries = loadSlowQueries()
  const q = queries.find(x => x.id === id)
  if (!q) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const settings = getSettings()
  const apiKey = settings.groqApiKey || process.env.GROQ_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Groq API key not configured. Set it in Settings → AI Copilot.' }, { status: 400 })
  }

  const groq = new Groq({ apiKey })
  const prompt = `You are a senior DBA and query optimization expert. Analyze this ${q.engine} query:

\`\`\`sql
${q.query}
\`\`\`

Statistics:
- Duration: ${q.durationMs}ms
${q.rowsExamined ? `- Rows examined: ${q.rowsExamined.toLocaleString()}` : ''}
${q.rowsReturned ? `- Rows returned: ${q.rowsReturned?.toLocaleString()}` : ''}
- Engine: ${q.engine}

Respond in this exact JSON format (no markdown, no extra text):
{
  "explanation": "Plain English explanation of what the query does and why it is slow",
  "bottleneck": "The main performance bottleneck in one sentence",
  "suggestions": ["suggestion 1", "suggestion 2", "suggestion 3"],
  "estimatedGain": "Estimated performance improvement e.g. '80-95% faster'",
  "indexSuggestions": ["CREATE INDEX ... statement if applicable"],
  "confidence": 88
}`

  try {
    const completion = await groq.chat.completions.create({
      model: settings.aiModel || 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 1024,
    })
    const raw = completion.choices[0]?.message?.content ?? '{}'
    recordUsage(completion.usage?.prompt_tokens ?? 0, completion.usage?.completion_tokens ?? 0, settings.aiModel || 'llama-3.3-70b-versatile')

    let analysis
    try { analysis = JSON.parse(raw) } catch {
      // Try to extract JSON from response
      const match = raw.match(/\{[\s\S]*\}/)
      analysis = match ? JSON.parse(match[0]) : { explanation: raw, bottleneck: 'See explanation', suggestions: [], estimatedGain: 'Unknown', indexSuggestions: [], confidence: 50 }
    }

    const updated = { ...q, analyzed: true, aiAnalysis: analysis }
    saveSlowQuery(updated)
    return NextResponse.json({ ok: true, aiAnalysis: analysis })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
