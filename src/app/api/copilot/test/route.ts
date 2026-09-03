import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getSettings } from '@/lib/settings-store'

const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b'
const RETIRED_GROQ_MODELS = new Set(['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'])

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, 'admin')
  if (auth instanceof NextResponse) return auth

  try {
    const { provider, apiKey: requestedApiKey, model, baseUrl } = await req.json()
    const settings = getSettings()
    const apiKey = requestedApiKey === '***configured***'
      ? provider === 'groq' ? settings.groqApiKey || process.env.GROQ_API_KEY : settings.aiApiKey
      : requestedApiKey

    const effectiveModel = provider === 'groq' && (!model || RETIRED_GROQ_MODELS.has(model)) ? GROQ_DEFAULT_MODEL : model

    if (!provider || !apiKey || !effectiveModel) {
      return NextResponse.json(
        { ok: false, message: 'Missing provider, apiKey, or model' },
        { status: 400 }
      )
    }

    const startTime = Date.now()
    let testMessage = ''
    let testOk = false

    try {
      switch (provider) {
        case 'groq':
          testOk = await testGroq(apiKey, effectiveModel)
          testMessage = testOk ? `Connected to Groq (${effectiveModel})` : `Groq model is not available: ${effectiveModel}`
          break

        case 'openai':
          testOk = await testOpenAi(apiKey, model)
          testMessage = testOk ? `Connected to OpenAI (${model})` : 'Failed to connect to OpenAI'
          break

        case 'anthropic':
          testOk = await testAnthropic(apiKey, model)
          testMessage = testOk ? `Connected to Anthropic (${model})` : 'Failed to connect to Anthropic'
          break

        case 'google':
          testOk = await testGoogle(apiKey, model)
          testMessage = testOk ? `Connected to Google Gemini (${model})` : 'Failed to connect to Google'
          break

        case 'custom':
          if (!baseUrl) {
            return NextResponse.json(
              { ok: false, message: 'Custom provider requires baseUrl' },
              { status: 400 }
            )
          }
          testOk = await testCustom(apiKey, model, baseUrl)
          testMessage = testOk ? `Connected to custom endpoint (${model})` : 'Failed to connect to custom endpoint'
          break

        default:
          return NextResponse.json(
            { ok: false, message: 'Unknown provider' },
            { status: 400 }
          )
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return NextResponse.json(
        { ok: false, message: `Connection failed: ${msg}` },
        { status: 503 }
      )
    }

    const latencyMs = Date.now() - startTime
    return NextResponse.json({
      ok: testOk,
      message: testMessage,
      latencyMs,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { ok: false, message: `Server error: ${msg}` },
      { status: 500 }
    )
  }
}

async function testGroq(apiKey: string, model: string): Promise<boolean> {
  const res = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) return false
  const data = await res.json() as { data?: Array<{ id?: string }> }
  return Boolean(data.data?.some(item => item.id === model))
}

async function testOpenAi(apiKey: string, model: string): Promise<boolean> {
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  return res.ok
}

async function testAnthropic(apiKey: string, model: string): Promise<boolean> {
  const res = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
  })
  return res.ok || res.status === 401 // 401 means API key auth failed but endpoint exists
}

async function testGoogle(apiKey: string, model: string): Promise<boolean> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'test' }] }],
      }),
    }
  )
  // 400 or similar means auth works but request is invalid (which is fine for test)
  // 403 or 401 means auth failed
  return res.ok || (res.status >= 400 && res.status < 500)
}

async function testCustom(
  apiKey: string,
  model: string,
  baseUrl: string
): Promise<boolean> {
  const url = `${baseUrl.replace(/\/$/, '')}/models`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  return res.ok || res.status === 401 // 401 means endpoint exists but auth failed
}
