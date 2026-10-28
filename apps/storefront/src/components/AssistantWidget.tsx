import { useEffect } from 'react';
import { useLocation } from 'wouter';

/**
 * Loads the Earthora chat assistant onto customer-facing pages.
 *
 * The widget itself is a self-contained script served by the API at
 * /widget.js, the same artifact given to third parties to embed. Loading it
 * here rather than reimplementing it in React keeps one assistant UI to
 * maintain, and it inherits any server-side fix without a storefront rebuild.
 *
 * `data-channel` is a PUBLIC channel key — it is designed to sit in a page's
 * HTML, exactly like a publishable payment key. It is not a secret.
 */

// Staff tools. A customer support bubble floating over the admin, KACC or
// developer consoles is noise, and it would overlap their own controls.
const STAFF_PREFIXES = ['/sun-earthora', '/kacc', '/developer'];

const CHANNEL_KEY = import.meta.env.VITE_ASSISTANT_CHANNEL_KEY as string | undefined;
const API_ORIGIN = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
const SCRIPT_ID = 'earthora-assistant-widget';
const WIDGET_VERSION = 'assistant20261028a';

export function widgetScriptUrl(apiOrigin: string): string {
  return `${apiOrigin}/widget.js?v=${WIDGET_VERSION}`;
}

export function AssistantWidget() {
  const [location] = useLocation();
  const onStaffPage = STAFF_PREFIXES.some((prefix) => location.startsWith(prefix));

  useEffect(() => {
    if (!CHANNEL_KEY || onStaffPage) return;
    if (document.getElementById(SCRIPT_ID)) return;

    // Deferred to idle so the assistant never competes with the storefront's
    // first paint; Home is the LCP page for most visitors.
    let cancelled = false;
    const load = (): void => {
      if (cancelled || document.getElementById(SCRIPT_ID)) return;
      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = widgetScriptUrl(API_ORIGIN);
      script.defer = true;
      script.dataset.channel = CHANNEL_KEY;
      if (API_ORIGIN) script.dataset.api = API_ORIGIN;
      document.body.appendChild(script);
    };

    // requestIdleCallback is unavailable on Safari before 17, so fall back to
    // a short timer there rather than blocking the load on it.
    const win = window as typeof window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const usedIdle = typeof win.requestIdleCallback === 'function';
    const handle = usedIdle
      ? win.requestIdleCallback!(load, { timeout: 3_000 })
      : window.setTimeout(load, 1_200);

    return () => {
      cancelled = true;
      if (usedIdle && typeof win.cancelIdleCallback === 'function') win.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, [onStaffPage]);

  // The widget owns its own launcher and panel, appended to <body>. Once
  // loaded it cannot be unmounted, so hide it on staff pages instead of
  // tearing down a script that may hold an open conversation.
  useEffect(() => {
    const launcher = document.querySelector<HTMLElement>('.ea-fab');
    const panel = document.querySelector<HTMLElement>('.ea-panel');
    if (launcher) launcher.style.display = onStaffPage ? 'none' : '';
    if (onStaffPage && panel) panel.classList.remove('open');
  }, [onStaffPage, location]);

  return null;
}

export default AssistantWidget;
