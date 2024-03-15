import OpenAI from 'openai'
import openAPISpec from '../../../lib/open-ai-retrieval/spec.json'

import { auth } from '@/auth'
import { OpenAIAPIRetrieval } from '@/lib/open-ai-retrieval'
import { kv } from '@vercel/kv'
import { OpenAIStream, StreamingTextResponse } from 'ai'
import { nanoid } from 'nanoid'

export const runtime = 'edge'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

export async function POST(req: Request) {
  const json = await req.json()
  const userId = (await auth())?.user.id

  const { messages, previewToken } = json

  if (!userId) {
    return new Response('Unauthorized', {
      status: 401
    })
  }

  if (previewToken) {
    openai.apiKey = previewToken
  }

  const retrieval = new OpenAIAPIRetrieval({
    apiKey: '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',
    model: 'gpt-4-1106-preview',
    openAPISpec: openAPISpec
  });

  // Cria o chat com as tools inicializadas
  const res = await retrieval.openai.chat.completions.create({
    model: 'gpt-4-1106-preview',
    messages: messages,
    tools: retrieval.init(), // Usa as funções da API inicializadas
    tool_choice: "auto",
    stream: true,
    temperature: 0.5,
  });

  const stream = OpenAIStream(res, {
    async experimental_onToolCall(
      toolCall,
      createFunctionCallMessages,
    ) {
      return retrieval.process({
        toolCall,
        messages,
        createFunctionCallMessages
      })
    },
    async onCompletion(completion) {
      const title = json.messages[0].content.substring(0, 100)
      const id = json.id ?? nanoid()
      const createdAt = Date.now()
      const path = `/chat/${id}`

      const payload = {
        id,
        title,
        userId,
        createdAt,
        path,
        messages: [
          ...messages,
          {
            content: completion,
            role: 'assistant'
          }
        ]
      }
      await kv.hmset(`chat:${id}`, payload)
      await kv.zadd(`user:chat:${userId}`, {
        score: createdAt,
        member: `chat:${id}`
      })
    }
  })

  return new StreamingTextResponse(stream)
}
