interface OpenAICompletion {
  choices?: Array<{
    index?: number
    message?: { content?: string }
    delta?: { content?: string }
    finish_reason?: string | null
  }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string }
}

export async function readOpenAICompletion(response: Response): Promise<OpenAICompletion> {
  const text = await response.text()
  const isStream = response.headers.get('content-type')?.includes('text/event-stream')
    || /^(?:data:|event:|:)/.test(text.trimStart())

  if (!isStream) return JSON.parse(text) as OpenAICompletion

  let content = ''
  let usage: OpenAICompletion['usage']
  let completed = false
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /, ''))
      .join('\n')
    if (!data) continue
    if (data.trim() === '[DONE]') {
      completed = true
      break
    }

    const chunk = JSON.parse(data) as OpenAICompletion
    if (chunk.error) throw new Error(chunk.error.message || 'AI provider stream failed.')
    if (chunk.usage) usage = chunk.usage
    const choice = chunk.choices?.find(item => item.index === undefined || item.index === 0)
    if (typeof choice?.delta?.content === 'string') content += choice.delta.content
    else if (typeof choice?.message?.content === 'string') content = choice.message.content
    if (choice?.finish_reason) completed = true
  }

  if (!completed) throw new Error('AI provider stream ended before completion.')
  return { choices: [{ message: { content } }], usage }
}
