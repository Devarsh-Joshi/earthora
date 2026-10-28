import OpenAI from 'openai';
import { config } from '../../config.js';
import type { ChatMessage, ChatResult, EmbeddingAdapter, LlmAdapter, ToolCall, ToolDef } from './types.js';

let client: OpenAI | null = null;
function oai(): OpenAI {
  if (!config.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
  client ??= new OpenAI({ apiKey: config.OPENAI_API_KEY, maxRetries: 1, timeout: 45_000 });
  return client;
}

function toOpenAiMessages(messages: ChatMessage[]): any[] {
  return messages.map((m) => {
    if (m.role === 'assistant' && m.tool_calls?.length) {
      return { role: 'assistant', content: m.content || null, tool_calls: m.tool_calls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) } })) };
    }
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content };
    return { role: m.role, content: m.content };
  });
}

function toOpenAiTools(tools?: ToolDef[]) {
  return tools?.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.parameters as any } }));
}

export const openaiLlm: LlmAdapter = {
  name: 'openai',
  async chat(messages, opts = {}) {
    const res = await oai().chat.completions.create({
      model: opts.model || config.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 700,
      messages: toOpenAiMessages(messages),
      tools: toOpenAiTools(opts.tools),
      tool_choice: opts.tools?.length ? 'auto' : undefined,
      response_format: opts.json ? { type: 'json_object' } : undefined,
    });
    const choice = res.choices[0];
    const toolCalls: ToolCall[] = (choice.message.tool_calls || []).map((tc: any) => ({ id: tc.id, name: tc.function.name, arguments: safeJson(tc.function.arguments) }));
    return { text: choice.message.content ?? '', toolCalls, model: res.model, usage: res.usage ? { promptTokens: res.usage.prompt_tokens, completionTokens: res.usage.completion_tokens } : undefined };
  },
  async stream(messages, opts) {
    const stream = await oai().chat.completions.create({
      model: opts.model || config.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: opts.temperature ?? 0.3, stream: true, messages: toOpenAiMessages(messages),
      tools: toOpenAiTools(opts.tools), tool_choice: opts.tools?.length ? 'auto' : undefined,
    });
    let text = ''; const toolAcc: Record<number, { id: string; name: string; args: string }> = {}; let model = '';
    for await (const chunk of stream) {
      model = chunk.model;
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) { text += delta.content; opts.onDelta(delta.content); }
      for (const tc of delta?.tool_calls ?? []) {
        const i = tc.index; toolAcc[i] ??= { id: '', name: '', args: '' };
        if (tc.id) toolAcc[i].id = tc.id;
        if (tc.function?.name) toolAcc[i].name += tc.function.name;
        if (tc.function?.arguments) toolAcc[i].args += tc.function.arguments;
      }
    }
    const toolCalls: ToolCall[] = Object.values(toolAcc).map((t) => ({ id: t.id, name: t.name, arguments: safeJson(t.args) }));
    return { text, toolCalls, model };
  },
};

export const openaiEmbedding: EmbeddingAdapter = {
  name: 'openai', model: 'text-embedding-3-small', dims: 1536,
  async embed(texts) {
    if (!texts.length) return [];
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 96) {
      const batch = texts.slice(i, i + 96).map((t) => (t.trim() ? t.slice(0, 8000) : ' '));
      const res = await oai().embeddings.create({ model: this.model, input: batch });
      for (const d of res.data.sort((a, b) => a.index - b.index)) out.push(d.embedding as number[]);
    }
    return out;
  },
};

function safeJson(s: string): Record<string, unknown> { try { return JSON.parse(s || '{}'); } catch { return {}; } }
