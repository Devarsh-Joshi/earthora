import { config } from '../../config.js';
import { openaiEmbedding, openaiLlm } from './openai.js';
import { geminiEmbedding, geminiLlm, googleAvailable } from './google.js';
/** Resolve the LLM for a channel/workflow. Default is OpenAI (works today); 'gemini' when the project is enabled. */
export function getLlm(pref) {
    if (pref === 'gemini' && googleAvailable())
        return geminiLlm;
    return openaiLlm;
}
/** Embedding model is fixed per KB once indexed. Launch default: OpenAI 1536. */
export function getEmbedding(pref) {
    if (pref === 'gemini' && googleAvailable())
        return geminiEmbedding;
    return openaiEmbedding;
}
export function providerStatus() {
    return {
        llm: { openai: Boolean(config.OPENAI_API_KEY), gemini: googleAvailable() },
        embedding: { openai: Boolean(config.OPENAI_API_KEY), gemini: googleAvailable() },
        default_llm: 'openai',
        default_embedding: `${openaiEmbedding.model} (${openaiEmbedding.dims}d)`,
    };
}
//# sourceMappingURL=index.js.map