import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getSettings } from '@/lib/settings-store'

const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b'
const RETIRED_GROQ_MODELS = new Set(['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'])

// Known-good model IDs surfaced in error messages so users can fix a typo'd/unsupported
// model without guessing. Kept in sync with the dropdown suggestions in the settings UI.
const SUGGESTED_MODELS: Record<string, string[]> = {
  groq: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'groq/compound', 'groq/compound-mini'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  anthropic: ['claude-3-5-sonnet-latest', 'claude-3-opus-latest', 'claude-3-haiku-latest'],
  google: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
}

type ProbeResult = { ok: boolean; reason?: 'auth' | 'model' }

// Bound outbound provider calls so a slow/unreachable upstream fails fast with a JSON
// error instead of hanging until a reverse proxy's gateway timeout returns an HTML page.
const FETCH_TIMEOUT_MS = 10_000

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${FETCH_TIMEOUT_MS / 1000}s`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function describeFailure(provider: string, model: string, result: ProbeResult): string {
  const providerLabel: Record<string, string> = {
    groq: 'Groq', openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google Gemini',
  }
  const label = providerLabel[provider] || provider
  if (result.reason === 'auth') {
    return `${label} rejected the API key. Double-check it's correct and active.`
  }
  if (result.reason === 'model') {
    const suggestions = SUGGESTED_MODELS[provider]
    const hint = suggestions ? ` Try one of: ${suggestions.join(', ')}.` : ''
    return `${label} key is valid, but model "${model}" is unavailable for this account.${hint}`
  }
  return `${label} key or model is unavailable (${model})`
}

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
        case 'groq': {
          const result = await testGroq(apiKey, effectiveModel)
          testOk = result.ok
          testMessage = testOk ? `Connected to Groq (${effectiveModel})` : describeFailure('groq', effectiveModel, result)
          break
        }

        case 'openai': {
          const result = await testOpenAi(apiKey, effectiveModel)
          testOk = result.ok
          testMessage = testOk ? `Connected to OpenAI (${effectiveModel})` : describeFailure('openai', effectiveModel, result)
          break
        }

        case 'anthropic': {
          const result = await testAnthropic(apiKey, effectiveModel)
          testOk = result.ok
          testMessage = testOk ? `Connected to Anthropic (${effectiveModel})` : describeFailure('anthropic', effectiveModel, result)
          break
        }

        case 'google': {
          const result = await testGoogle(apiKey, effectiveModel)
          testOk = result.ok
          testMessage = testOk ? `Connected to Google Gemini (${effectiveModel})` : describeFailure('google', effectiveModel, result)
          break
        }

        case 'custom':
          if (!baseUrl) {
            return NextResponse.json(
              { ok: false, message: 'Custom provider requires baseUrl' },
              { status: 400 }
            )
          }
          testOk = await testCustom(apiKey, effectiveModel, baseUrl)
          testMessage = testOk ? `Connected to custom endpoint (${effectiveModel})` : 'Custom endpoint rejected the configured credentials or model'
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

async function testGroq(apiKey: string, model: string): Promise<ProbeResult> {
  const res = await fetchWithTimeout('https://api.groq.com/openai/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) return { ok: false, reason: 'auth' }
  const data = await res.json() as { data?: Array<{ id?: string }> }
  const ok = Boolean(data.data?.some(item => item.id === model))
  return ok ? { ok: true } : { ok: false, reason: 'model' }
}

async function testOpenAi(apiKey: string, model: string): Promise<ProbeResult> {
  const res = await fetchWithTimeout('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) return { ok: false, reason: 'auth' }
  const data = await res.json() as { data?: Array<{ id?: string }> }
  const ok = Boolean(data.data?.some(item => item.id === model))
  return ok ? { ok: true } : { ok: false, reason: 'model' }
}

async function testAnthropic(apiKey: string, model: string): Promise<ProbeResult> {
  const res = await fetchWithTimeout('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
  })
  if (!res.ok) return { ok: false, reason: 'auth' }
  const data = await res.json() as { data?: Array<{ id?: string }> }
  const ok = Boolean(data.data?.some(item => item.id === model))
  return ok ? { ok: true } : { ok: false, reason: 'model' }
}

async function testGoogle(apiKey: string, model: string): Promise<ProbeResult> {
  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
  )
  if (!res.ok) return { ok: false, reason: 'auth' }
  const data = await res.json() as {
    models?: Array<{ name?: string; baseModelId?: string; supportedGenerationMethods?: string[] }>
  }
  const match = data.models?.find(item => {
    const shortName = item.name?.replace(/^models\//, '') ?? ''
    return shortName === model || shortName.startsWith(`${model}-`) || item.baseModelId === model
  })
  const ok = Boolean(match && (!match.supportedGenerationMethods || match.supportedGenerationMethods.includes('generateContent')))
  return ok ? { ok: true } : { ok: false, reason: 'model' }
}

async function testCustom(
  apiKey: string,
  model: string,
  baseUrl: string
): Promise<boolean> {
  const url = `${baseUrl.replace(/\/$/, '')}/models`
  const res = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  return res.ok
}
