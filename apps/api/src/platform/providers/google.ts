/**
 * Google adapters — Gemini (LLM + embeddings).
 * Activated when GEMINI_API_KEY works (project currently returns 403) or a service-account JSON is present.
 * Until then the registry keeps OpenAI as the working default and these are selectable per channel.
 */
import { GoogleGenAI } from '@google/genai';
import { config } from '../../config.js';
import type { ChatMessage, EmbeddingAdapter, LlmAdapter, ToolCall } from './types.js';

let genai: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (!config.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');
  genai ??= new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  return genai;
}

export function googleAvailable(): boolean { return Boolean(config.GEMINI_API_KEY); }

export const geminiLlm: LlmAdapter = {
  name: 'gemini',
  async chat(messages, opts = {}) {
    const model = opts.model || 'gemini-3.5-flash';
    const contents = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const res = await client().models.generateContent({
      model, contents,
      config: { systemInstruction: system || undefined, temperature: opts.temperature ?? 0.3, maxOutputTokens: opts.maxTokens ?? 700, responseMimeType: opts.json ? 'application/json' : undefined },
    });
    const text = res.text ?? '';
    const toolCalls: ToolCall[] = (res.functionCalls ?? []).map((fc, i) => ({ id: `call_${i}`, name: fc.name ?? '', arguments: (fc.args as Record<string, unknown>) ?? {} }));
    return { text, toolCalls, model };
  },
};

export const geminiEmbedding: EmbeddingAdapter = {
  name: 'gemini', model: 'gemini-embedding-001', dims: 1536,
  async embed(texts) {
    if (!texts.length) return [];
    const res = await client().models.embedContent({ model: this.model, contents: texts.map((t) => t.slice(0, 8000)), config: { outputDimensionality: this.dims } });
    return (res.embeddings ?? []).map((e) => e.values as number[]);
  },
};
