import Groq from 'groq-sdk'
import { getGlobalEnv } from './global.mjs'

function requireEnv(name) {
  const globalEnv = getGlobalEnv()
  const v = globalEnv[name] || process.env[name]
  if (!v) throw new Error(`Missing ${name} in API settings`)
  return v
}

export function createGroqClient() {
  const apiKey = requireEnv('GROQ_API_KEY')
  return new Groq({ apiKey })
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
