// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const route = vi.hoisted(() => ({ path: '/health-benefits' }));
vi.mock('wouter', () => ({ useLocation: () => [route.path] }));

import ScrollToTop from './ScrollToTop';

let root: Root;
let mount: HTMLDivElement;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  route.path = '/health-benefits';
  window.history.replaceState(null, '', '/health-benefits');
  window.matchMedia = vi.fn(() => ({ matches: true } as MediaQueryList));
  window.scrollTo = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 100, 100)] as unknown as DOMRectList);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
  act(() => root.render(<ScrollToTop />));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('public route hash scrolling', () => {
  it('waits for the home product section after a link from the lazy health page', async () => {
    const oldPage = document.createElement('div');
    oldPage.dataset.earthoraPage = '/health-benefits';
    document.body.appendChild(oldPage);

    window.history.pushState(null, '', '/#products');
    route.path = '/';
    act(() => root.render(<ScrollToTop />));
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();

    const home = document.createElement('div');
    home.dataset.earthoraPage = '/';
    const products = document.createElement('section');
    products.id = 'products';
    home.appendChild(products);
    document.body.appendChild(home);

    await new Promise(resolve => setTimeout(resolve, 15));
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'start', behavior: 'auto' });
    expect(products.style.scrollMarginTop).toBe('96px');
  });

  it('also resolves the same anchor at a mobile viewport after the route mounts', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    window.history.pushState(null, '', '/#products');
    route.path = '/';
    act(() => root.render(<ScrollToTop />));

    const home = document.createElement('div');
    home.dataset.earthoraPage = '/';
    home.innerHTML = '<section id="products"></section>';
    document.body.appendChild(home);

    await new Promise(resolve => setTimeout(resolve, 15));
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'start', behavior: 'auto' });
  });
});
