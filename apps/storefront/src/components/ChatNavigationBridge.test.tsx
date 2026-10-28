// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ location: '/health-benefits', navigate: vi.fn() }));
vi.mock('wouter', () => ({ useLocation: () => [router.location, router.navigate] }));
import { ChatNavigationBridge, productNavigationForChat } from './ChatNavigationBridge';
import { StorefrontNavigationBridge } from './StorefrontNavigationBridge';

let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, '', '/health-benefits');
  window.matchMedia = vi.fn(() => ({ matches: true } as MediaQueryList));
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 100, 100)] as unknown as DOMRectList);
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  router.location = '/health-benefits';
  router.navigate.mockReset();
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
  act(() => root.render(<><StorefrontNavigationBridge /><ChatNavigationBridge /></>));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('typed-chat product navigation', () => {
  it('takes an explicit product-show request across routes and keeps the widget DOM mounted', async () => {
    const widget = document.createElement('div');
    widget.className = 'ea-panel open';
    document.body.appendChild(widget);
    router.navigate.mockImplementation((path: string) => {
      window.history.pushState(null, '', path);
      setTimeout(() => {
        const page = document.createElement('div');
        page.dataset.earthoraPage = '/';
        page.innerHTML = '<section id="products">Moringa tablets</section>';
        document.body.appendChild(page);
      }, 0);
    });

    act(() => window.dispatchEvent(new CustomEvent('earthora:chat:completed', {
      detail: { message: 'Please take me to the moringa tablets and show the product on this page.' },
    })));
    await vi.waitFor(() => expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledOnce());
    expect(router.navigate).toHaveBeenCalledWith('/#products');
    expect(window.location.pathname + window.location.hash).toBe('/#products');
    expect(document.activeElement?.id).toBe('products');
    expect(document.querySelector('.ea-panel')).toBe(widget);
  });

  it('does not navigate for an information question or a negated request', () => {
    expect(productNavigationForChat('What are your products and how many do you sell?')).toBeNull();
    expect(productNavigationForChat('Please do not show me the product page.')).toBeNull();
    expect(productNavigationForChat('Show me how to use the moringa tablets.')).toBeNull();
    act(() => window.dispatchEvent(new CustomEvent('earthora:chat:completed', {
      detail: { message: 'What are your products and how many do you sell?' },
    })));
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
