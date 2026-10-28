import { useEffect } from "react";
import { useLocation } from "wouter";

export default function ScrollToTop() {
  const [pathname] = useLocation();

  useEffect(() => {
    let frame = 0;
    let timeout = 0;
    let observer: MutationObserver | undefined;

    const stopWatching = () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
      observer?.disconnect();
      observer = undefined;
    };

    const scrollForLocation = () => {
      stopWatching();
      const hash = window.location.hash.slice(1);
      let anchor = '';
      try {
        anchor = decodeURIComponent(hash);
      } catch {
        window.scrollTo(0, 0);
        return;
      }
      if (!anchor) {
        window.scrollTo(0, 0);
        return;
      }

      // A route can render a loading fallback before its target is mounted.
      // Wait for the destination page so cross-page hash links land correctly.
      const tryAnchor = () => {
        window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(() => {
          if (window.location.pathname !== pathname || window.location.hash.slice(1) !== hash) return;
          const target = document.getElementById(anchor);
          const pages = Array.from(document.querySelectorAll<HTMLElement>('[data-earthora-page]'));
          const page = pages.find(element => element.dataset.earthoraPage === pathname);
          if (!target || !target.getClientRects().length || (pages.length > 0 && (!page || !page.contains(target)))) return;
          target.style.scrollMarginTop = '96px';
          target.scrollIntoView({
            block: 'start',
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          });
          stopWatching();
        });
      };

      window.scrollTo(0, 0);
      observer = new MutationObserver(tryAnchor);
      observer.observe(document.body, { childList: true, subtree: true });
      timeout = window.setTimeout(stopWatching, 8000);
      tryAnchor();
    };

    window.addEventListener('hashchange', scrollForLocation);
    scrollForLocation();
    return () => {
      window.removeEventListener('hashchange', scrollForLocation);
      stopWatching();
    };
  }, [pathname]);

  return null;
}
