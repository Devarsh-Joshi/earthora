export interface ChatMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; tool_calls?: ToolCall[]; name?: string }
export interface ToolDef { name: string; description: string; parameters: Record<string, unknown> }
export interface ToolCall { id: string; name: string; arguments: Record<string, unknown> }
export interface ChatResult { text: string; toolCalls: ToolCall[]; usage?: { promptTokens: number; completionTokens: number }; model: string }

export interface LlmAdapter {
  readonly name: string;
  chat(messages: ChatMessage[], opts?: { tools?: ToolDef[]; temperature?: number; maxTokens?: number; json?: boolean; model?: string }): Promise<ChatResult>;
  stream?(messages: ChatMessage[], opts: { tools?: ToolDef[]; temperature?: number; onDelta: (t: string) => void; model?: string }): Promise<ChatResult>;
}

export interface EmbeddingAdapter {
  readonly name: string;
  readonly model: string;
  readonly dims: number;
  embed(texts: string[]): Promise<number[][]>;
}
