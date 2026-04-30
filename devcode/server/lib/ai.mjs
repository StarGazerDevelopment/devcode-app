import Groq from 'groq-sdk'
import { getGlobalEnv } from './global.mjs'

function requireEnv(name) {
  const globalEnv = getGlobalEnv()
  const v = globalEnv[name] || process.env[name]
  if (!v) throw new Error(`Missing ${name} in API settings`)
  return v
}

export function createGroqClient() {
  const globalEnv = getGlobalEnv()
  const provider = globalEnv.DEVCODE_PROVIDER || 'GROQ_API_KEY'
  const apiKey = globalEnv[provider] || process.env[provider]

  if (!apiKey) throw new Error(`Missing ${provider} in API settings`)

  let baseURL = undefined
  if (provider === 'OPENAI_API_KEY') baseURL = 'https://api.openai.com/v1'
  if (provider === 'OPENROUTER_API_KEY') baseURL = 'https://openrouter.ai/api/v1'
  if (provider === 'TOGETHER_API_KEY') baseURL = 'https://api.together.xyz/v1'
  if (provider === 'DEEPSEEK_API_KEY') baseURL = 'https://api.deepseek.com'
  if (provider === 'MISTRAL_API_KEY') baseURL = 'https://api.mistral.ai/v1'
  if (provider === 'PERPLEXITY_API_KEY') baseURL = 'https://api.perplexity.ai'
  if (provider === 'GEMINI_API_KEY') baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/'
  if (provider === 'AZURE_OPENAI_API_KEY') baseURL = 'https://api.openai.com/v1' // Assuming custom config needed
  if (provider === 'CUSTOM_ENDPOINT_KEY') baseURL = globalEnv.CUSTOM_ENDPOINT_URL || process.env.CUSTOM_ENDPOINT_URL || 'http://localhost:11434/v1'

  // Note: Anthropic and Cohere do not natively support OpenAI's format without a proxy. 
  // For Anthropic, you'd typically need a separate SDK or proxy. For now, it will fail unless passed through a proxy.

  return new Groq({ apiKey, baseURL })
}

export function defaultModel() {
  const globalEnv = getGlobalEnv()
  return globalEnv.DEVCODE_MODEL || globalEnv.GROQ_MODEL || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
}

export async function runAgent({ groq, model, messages, tools, toolHandlers, onToken, maxSteps = 6 }) {
  const transcript = [...messages]

  for (let step = 0; step < maxSteps; step += 1) {
    const res = await groq.chat.completions.create({
      model,
      messages: transcript,
      tools,
      tool_choice: 'auto',
      temperature: 0.2,
      stream: true,
    })

    let fullContent = ''
    let toolCalls = []

    for await (const chunk of res) {
      const delta = chunk.choices[0]?.delta
      if (!delta) continue

      if (delta.content) {
        fullContent += delta.content
        if (onToken) onToken(delta.content)
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!toolCalls[tc.index]) {
            toolCalls[tc.index] = {
              id: tc.id || '',
              type: 'function',
              function: { name: tc.function?.name || '', arguments: '' }
            }
          }
          if (tc.function?.arguments) {
            toolCalls[tc.index].function.arguments += tc.function.arguments
          }
        }
      }
    }

    toolCalls = toolCalls.filter(Boolean)

    const msg = { role: 'assistant', content: fullContent || null }
    if (toolCalls.length > 0) {
      msg.tool_calls = toolCalls
    }
    transcript.push(msg)

    if (!toolCalls.length) {
      return { transcript, message: msg }
    }

    for (const call of toolCalls) {
      const name = call.function?.name
      const rawArgs = call.function?.arguments ?? '{}'
      const handler = toolHandlers[name]
      if (!handler) {
        transcript.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ ok: false, error: `Unknown tool: ${name}` }),
        })
        continue
      }
      let args
      try {
        args = JSON.parse(rawArgs)
      } catch {
        args = {}
      }
      try {
        const result = await handler(args)
        transcript.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ ok: true, result }),
        })
      } catch (e) {
        transcript.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ ok: false, error: e?.message || String(e) }),
        })
      }
    }
  }

  return { transcript, message: transcript.at(-1) }
}
