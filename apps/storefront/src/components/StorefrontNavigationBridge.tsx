import { useEffect, type ComponentType } from 'react';
import { useLocation } from 'wouter';

type Destination = { id:string; path:string; anchor:string|null; label:string };
type Result = {ok:boolean; reason?:string};
type Bridge = {navigate:(destination:Destination, signal:AbortSignal)=>Promise<Result>};
declare global { interface Window { EarthoraStorefrontNavigation?:Bridge } }

const PUBLIC_PATHS = new Set(['/', '/our-story', '/health-benefits', '/contact', '/faq', '/shipping-policy', '/privacy-policy', '/terms-of-use', '/cart']);

/** Marks the committed public page, including lazy-loaded routes. */
export function withStorefrontPage<T extends object>(Page:ComponentType<T>) {
  return function StorefrontPage(props:T) {
    const [path] = useLocation();
    return <div data-earthora-page={path} style={{display:'contents'}}><Page {...props} /></div>;
  };
}

/** Lives above the route switch: navigation never remounts the assistant widget. */
export function StorefrontNavigationBridge() {
  const [,setLocation] = useLocation();
  useEffect(()=>{
    const pending = new Set<()=>void>();
    const bridge:Bridge = { navigate(destination,signal) {
      const {path,anchor} = destination;
      if ((!PUBLIC_PATHS.has(path) && !/^\/product\/[a-zA-Z0-9_-]{1,120}$/.test(path)) || (anchor !== null && !/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(anchor))) return Promise.resolve({ok:false,reason:'invalid_destination'});
      if (signal.aborted) return Promise.resolve({ok:false,reason:'navigation_cancelled'});
      const active=document.activeElement;
      if (((active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) && active.value.trim()) || (active instanceof HTMLElement && active.isContentEditable && active.textContent?.trim())) return Promise.resolve({ok:false,reason:'form_active'});
      return new Promise<Result>(resolve=>{
        let finished = false;
        let frame = 0;
        let observer:MutationObserver;
        const finish=(result:Result)=>{
          if (finished) return;
          finished=true; clearTimeout(timeout); cancelAnimationFrame(frame); observer.disconnect();
          signal.removeEventListener('abort',cancel); pending.delete(cancel); resolve(result);
        };
        const cancel=()=>finish({ok:false,reason:'navigation_cancelled'});
        const check=()=>{
          cancelAnimationFrame(frame);
          frame=requestAnimationFrame(()=>{
            if (finished || signal.aborted) return;
            // Require the destination page's own committed DOM, rather than
            // the previous page or Suspense skeleton while chunks load.
            const page=Array.from(document.querySelectorAll<HTMLElement>('[data-earthora-page]')).find(el=>el.dataset.earthoraPage === path);
            if (!page || window.location.pathname !== path) return;
            const target=anchor ? document.getElementById(anchor) : page.querySelector<HTMLElement>('h1');
            if (!target || !page.contains(target) || !target.getClientRects().length) return;
            if (page.querySelector('[data-page-error]')) { finish({ok:false,reason:'page_unavailable'}); return; }
            // ScrollToTop has already run for this route. Keep the target clear
            // of the fixed site header and respect reduced-motion preferences.
            const previousTabIndex=target.getAttribute('tabindex');
            target.setAttribute('tabindex','-1'); target.style.scrollMarginTop='96px';
            target.focus({preventScroll:true});
            target.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
            target.addEventListener('blur',()=>{
              if (previousTabIndex === null) target.removeAttribute('tabindex'); else target.setAttribute('tabindex',previousTabIndex);
            },{once:true});
            finish({ok:true});
          });
        };
        const timeout=window.setTimeout(()=>finish({ok:false,reason:'navigation_timeout'}),8000);
        observer=new MutationObserver(check); observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-earthora-page','style']});
        signal.addEventListener('abort',cancel,{once:true}); pending.add(cancel);
        setLocation(path + (anchor ? '#'+anchor : ''));
        check();
      });
    }};
    window.EarthoraStorefrontNavigation=bridge;
    return ()=>{ pending.forEach(cancel=>cancel()); if (window.EarthoraStorefrontNavigation === bridge) delete window.EarthoraStorefrontNavigation; };
  },[setLocation]);
  return null;
}
