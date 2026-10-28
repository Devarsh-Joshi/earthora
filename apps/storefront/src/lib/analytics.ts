import { supabase } from './supabase';

let geoCache: { ip: string; country: string; city: string } | null = null;

function parseUA(ua: string) {
  const device = /Tablet|iPad/i.test(ua) ? 'Tablet' : /Mobi|Android|iPhone|iPod/i.test(ua) ? 'Mobile' : 'Desktop';
  const os = ua.includes('Win') ? 'Windows' : ua.includes('Mac') ? 'MacOS' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : ua.includes('Linux') ? 'Linux' : ua.includes('X11') ? 'UNIX' : 'Unknown OS';
  const browser = ua.includes('Edg') ? 'Edge' : ua.includes('Chrome') ? 'Chrome' : ua.includes('Firefox') ? 'Firefox' : ua.includes('Safari') ? 'Safari' : ua.includes('MSIE') || ua.includes('Trident') ? 'IE' : 'Unknown Browser';
  return { device, os, browser };
}

async function getGeo() {
  if (geoCache) return geoCache;
  if (!import.meta.env.PROD) return { ip: '127.0.0.1', country: 'Localhost', city: 'Localhost' };

  try {
    const cached = sessionStorage.getItem('earthora_visitor_geo');
    if (cached) {
      geoCache = JSON.parse(cached);
      return geoCache!;
    }
    const res = await fetch('https://ipwho.is/');
    if (!res.ok) return { ip: '127.0.0.1', country: 'Unknown', city: 'Unknown' };
    const data = await res.json();
    if (data?.success !== false) {
      geoCache = { ip: data.ip, country: data.country, city: data.city };
      sessionStorage.setItem('earthora_visitor_geo', JSON.stringify(geoCache));
      return geoCache;
    }
  } catch {
    /* silent */
  }
  return { ip: '127.0.0.1', country: 'Unknown', city: 'Unknown' };
}

const INTERNAL_ROUTE_PREFIXES = ['/sun-earthora', '/developer', '/kacc'];

export async function trackPageView(pageName: string) {
  if (INTERNAL_ROUTE_PREFIXES.some((prefix) => pageName.startsWith(prefix))) return;
  // Checkout paths contain a short-lived possession capability. Never retain it in analytics.
  if (/^\/ai-checkout\//.test(pageName)) pageName = '/checkout-review';
  if (sessionStorage.getItem('earthora_session_tracked')) return;
  sessionStorage.setItem('earthora_session_tracked', '1');

  try {
    const geo = await getGeo();
    const ua = navigator.userAgent;
    const { device, os, browser } = parseUA(ua);

    await (supabase.from('Admin_analytics') as any).insert({
      page_name: pageName,
      visitor_ip: geo.ip,
      visitor_device: device,
      visitor_os: os,
      visitor_browser: browser,
      visitor_country: geo.country,
      visitor_city: geo.city,
    });
  } catch {
    // analytics failures must never break the UI
  }
}
