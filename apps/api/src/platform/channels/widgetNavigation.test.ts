import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const widgetSource = readFileSync(new URL('../../../public/widget.js', import.meta.url), 'utf8');
let dom: JSDOM | undefined;
afterEach(() => { dom?.window.close(); dom = undefined; });

function mountWidget(reply: { ok: boolean; body?: string }) {
  dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://www.earthorafarms.com/', runScripts: 'outside-only',
  });
  const win = dom.window;
  const script = win.document.createElement('script');
  script.src = 'https://api.earthorafarms.com/widget.js';
  script.dataset.channel = 'public-test';
  win.document.body.appendChild(script);
  Object.defineProperty(win.document, 'currentScript', { configurable: true, get: () => script });
  (win as any).matchMedia = () => ({ matches: true });
  (win as any).TextDecoder = TextDecoder;
  vi.spyOn(win.HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  (win as any).fetch = vi.fn((url: string) => {
    if (url.endsWith('/config')) return Promise.resolve({ json: async () => ({ name: 'Eva', starters: [] }) });
    let sent = false;
    return Promise.resolve({
      ok: reply.ok,
      status: reply.ok ? 200 : 503,
      body: reply.body ? { getReader: () => ({ read: async () => {
        if (sent) return { done: true };
        sent = true;
        return { done: false, value: new TextEncoder().encode(reply.body) };
      } }) } : null,
    });
  });
  win.eval(widgetSource);
  return win;
}

describe('embedded typed-chat navigation signal', () => {
  it('emits the visitor request only after the chat turn completes successfully', async () => {
    const win = mountWidget({ ok: true, body: 'event: done\ndata: {"reply":"Here are the tablets.","conversationId":"c1"}\n\n' });
    const listener = vi.fn();
    win.addEventListener('earthora:chat:completed', listener);
    const input = win.document.querySelector<HTMLTextAreaElement>('.ea-in')!;
    input.value = 'Please take me to the moringa tablets and show the product on this page.';
    win.document.querySelector<HTMLButtonElement>('.ea-send')!.click();
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce());
    expect(listener.mock.calls[0][0].detail.message).toBe(input.value || 'Please take me to the moringa tablets and show the product on this page.');
  });

  it('does not emit navigation when chat fails', async () => {
    const win = mountWidget({ ok: false });
    const listener = vi.fn();
    win.addEventListener('earthora:chat:completed', listener);
    const input = win.document.querySelector<HTMLTextAreaElement>('.ea-in')!;
    input.value = 'Show me the product';
    win.document.querySelector<HTMLButtonElement>('.ea-send')!.click();
    await vi.waitFor(() => expect(win.document.querySelector('.ea-b.err')).not.toBeNull());
    expect(listener).not.toHaveBeenCalled();
  });
});
