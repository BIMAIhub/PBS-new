import { GoogleGenAI } from '@google/genai';
import { getVercelOidcToken } from '@vercel/oidc';
import { RequestError } from './http.js';

export const aiConfigured = () => Boolean(process.env.GEMINI_API_KEY || process.env.AI_GATEWAY_API_KEY || process.env.VERCEL || process.env.VERCEL_OIDC_TOKEN);
export async function generateLearningText(system: string, prompt: string, json = false, request: typeof fetch = fetch) {
  if (process.env.GEMINI_API_KEY) {
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const model = process.env.PBS_GEMINI_MODEL || 'gemini-2.5-flash';
    const result = await client.models.generateContent({ model, contents: prompt, config: {
      systemInstruction: system, maxOutputTokens: json ? 6000 : 1200, ...(json ? { responseMimeType: 'application/json' } : {}),
    } });
    if (!result.text) throw new RequestError(502, 'The AI service returned no draft. Please try again.');
    return { text: result.text, model };
  }
  let token = process.env.AI_GATEWAY_API_KEY || '';
  if (!token) { try { token = await getVercelOidcToken(); } catch {} }
  if (!token) throw new RequestError(503, 'Connect AI Gateway on Vercel, or configure a server AI key to generate curriculum drafts.');
  const model = process.env.PBS_CURRICULUM_MODEL || 'google/gemini-2.5-flash-lite';
  let response: globalThis.Response;
  try {
    response = await request('https://ai-gateway.vercel.sh/v1/chat/completions', { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(50_000),
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        max_tokens: json ? 6000 : 1200, temperature: .4, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
    });
  } catch { throw new RequestError(502, 'The AI service could not finish this request. Your course has not changed.'); }
  if (!response.ok) {
    await response.body?.cancel();
    const reason = response.status === 402 ? 'AI Gateway credits or a spending limit need attention in Vercel.' :
      response.status === 401 || response.status === 403 ? 'Check AI Gateway access and account verification in Vercel.' :
      response.status === 429 ? 'The AI service is busy. Please try again shortly.' : 'The AI service is temporarily unavailable.';
    throw new RequestError(503, reason);
  }
  const data = await response.json() as { choices?: { message?: { content?: string } }[]; model?: string };
  const text = data.choices?.[0]?.message?.content;
  if (!text || text.length > 60000) throw new RequestError(502, 'The AI service returned an incomplete draft. Please try again.');
  return { text, model: data.model || model };
}
