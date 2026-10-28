import { lazy, Suspense, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter, Redirect, useLocation } from 'wouter';
import { CartProvider } from '@/contexts/cart-context';
import { AuthProvider } from '@/contexts/auth-context';
import { trackPageView } from '@/lib/analytics';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Gate } from '@/components/Gate';
import ScrollToTop from '@/components/ScrollToTop';
import { AssistantWidget } from '@/components/AssistantWidget';
import { StorefrontNavigationBridge, withStorefrontPage } from '@/components/StorefrontNavigationBridge';
import { ChatNavigationBridge } from '@/components/ChatNavigationBridge';
import { CatalogFreshnessBridge } from '@/components/CatalogFreshnessBridge';
import { PageSkeleton } from '@/components/ui/PageSkeleton';
import { SeoManager } from '@/seo/SeoManager';
// Home is eager — it's the LCP page for most visitors
import Home from './pages/home';
import { KaccGate } from '@/components/KaccGate';
import NotFound from './pages/not-found';

const PageLoader = () => <PageSkeleton />;

function lazyWithRetry<T extends React.ComponentType<any>>(
  componentImport: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    try {
      const pageHasBeenReloaded = sessionStorage.getItem('page_reloaded_for_chunk');
      const component = await componentImport();
      if (pageHasBeenReloaded) {
        sessionStorage.removeItem('page_reloaded_for_chunk');
      }
      return component;
    } catch (error: any) {
      const pageHasBeenReloaded = sessionStorage.getItem('page_reloaded_for_chunk');
      if (!pageHasBeenReloaded) {
        sessionStorage.setItem('page_reloaded_for_chunk', 'true');
        window.location.reload();
        return new Promise<{ default: T }>(() => {});
      }
      throw error;
    }
  });
}

const PublicHome = withStorefrontPage(Home);

// Public routes — lazy-loaded to keep the initial bundle small
const OurStory       = withStorefrontPage(lazyWithRetry(() => import('./pages/our-story')));
const Contact        = withStorefrontPage(lazyWithRetry(() => import('./pages/contact')));
const HealthBenefits = withStorefrontPage(lazyWithRetry(() => import('./pages/health-benefits')));
const ProductDetail  = withStorefrontPage(lazyWithRetry(() => import('./pages/product-detail')));
const Cart           = withStorefrontPage(lazyWithRetry(() => import('./pages/cart')));
const Favorites      = lazyWithRetry(() => import('./pages/favorites'));
const AiCheckout = lazyWithRetry(() => import('./pages/ai-checkout'));
const ReviewOrder    = lazyWithRetry(() => import('./pages/review-order'));
const ShippingPolicy = withStorefrontPage(lazyWithRetry(() => import('./pages/shipping-policy')));
const FAQ            = withStorefrontPage(lazyWithRetry(() => import('./pages/faq')));
const PrivacyPolicy  = withStorefrontPage(lazyWithRetry(() => import('./pages/privacy-policy')));
const TermsOfUse     = withStorefrontPage(lazyWithRetry(() => import('./pages/terms-of-use')));
const CookieSettings = lazyWithRetry(() => import('./pages/cookie-settings'));

// Admin routes
const AdminLayout         = lazyWithRetry(() => import('./pages/sun-earthora/layout'));
const AdminDashboard      = lazyWithRetry(() => import('./pages/sun-earthora/dashboard'));
const AdminProducts       = lazyWithRetry(() => import('./pages/sun-earthora/products'));
const AdminOrders         = lazyWithRetry(() => import('./pages/sun-earthora/orders'));
const AdminAnalytics      = lazyWithRetry(() => import('./pages/sun-earthora/analytics'));
const AdminAssistantKnowledge = lazyWithRetry(() => import('./pages/sun-earthora/assistant-knowledge'));
const AdminSettings       = lazyWithRetry(() => import('./pages/sun-earthora/settings'));
const DeveloperLayout     = lazyWithRetry(() => import('./pages/developer/layout'));
const DeveloperDashboard  = lazyWithRetry(() => import('./pages/developer/dashboard'));
const DeveloperWebsite    = lazyWithRetry(() => import('./pages/developer/website'));
const DeveloperPasswords  = lazyWithRetry(() => import('./pages/developer/passwords'));

// KACC routes
const KaccLayout    = lazyWithRetry(() => import('./pages/kacc/layout'));
const KaccDashboard = lazyWithRetry(() => import('./pages/kacc/dashboard'));
const KaccB2BGst    = lazyWithRetry(() => import('./pages/kacc/b2b-gst'));
const KaccB2CNonGst = lazyWithRetry(() => import('./pages/kacc/b2c-nongst'));
const KaccProducts  = lazyWithRetry(() => import('./pages/kacc/products'));

function Fallback() {
  return <NotFound />;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: 2,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

function PageTracker() {
  const [loc] = useLocation();
  useEffect(() => { trackPageView(loc); }, [loc]);
  return null;
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <CatalogFreshnessBridge />
        <AuthProvider>
          <CartProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
              <PageTracker />
              <SeoManager />
              <ScrollToTop />
              <AssistantWidget />
              <StorefrontNavigationBridge />
              <ChatNavigationBridge />
              <Suspense fallback={<PageLoader />}>
                <Switch>
                  <Route path="/" component={PublicHome} />
                  <Route path="/our-story" component={OurStory} />
                  <Route path="/contact" component={Contact} />
                  <Route path="/health-benefits" component={HealthBenefits} />
                  <Route path="/our-product">
                    <Redirect to="/#products" />
                  </Route>
                  <Route path="/product/:id" component={ProductDetail} />
                  <Route path="/cart" component={Cart} />
                  <Route path="/favorites" component={Favorites} />
                  <Route path="/checkout">
                    <Redirect to="/cart" />
                  </Route>
                  <Route path="/ai-checkout/:token" component={AiCheckout} />
                  <Route path="/review-order" component={ReviewOrder} />
                  <Route path="/shipping-policy" component={ShippingPolicy} />
                  <Route path="/faq" component={FAQ} />
                  <Route path="/privacy-policy" component={PrivacyPolicy} />
                  <Route path="/terms-of-use" component={TermsOfUse} />
                  <Route path="/cookie-settings" component={CookieSettings} />
                  <Route path="/auth">
                    <Redirect to="/" />
                  </Route>

                  <Route path="/sun-earthora">
                    <Redirect to="/sun-earthora/dashboard" />
                  </Route>
                  <Route path="/sun-earthora/:rest*">
                    <Gate
                      storageKey="admin_authenticated"
                      passwordKey="admin_password"
                      title="Admin Portal"
                      subtitle="Enter your security password"
                      passwordPlaceholder="Security Password"
                      submitLabel="Authenticate"
                      loadingLabel={'Verifying\u2026'}
                    >
                      <AdminLayout>
                        <Switch>
                          <Route path="/sun-earthora/dashboard" component={AdminDashboard} />
                          <Route path="/sun-earthora/products" component={AdminProducts} />
                          <Route path="/sun-earthora/orders" component={AdminOrders} />
                          <Route path="/sun-earthora/assistant-knowledge" component={AdminAssistantKnowledge} />
                          <Route path="/sun-earthora/analytics" component={AdminAnalytics} />
                          <Route path="/sun-earthora/settings" component={AdminSettings} />
                          <Route>
                            <Redirect to="/sun-earthora/dashboard" />
                          </Route>
                        </Switch>
                      </AdminLayout>
                    </Gate>
                  </Route>

                  <Route path="/kacc">
                    <Redirect to="/kacc/dashboard" />
                  </Route>
                  <Route path="/kacc/:rest*">
                    <KaccGate>
                      <KaccLayout>
                        <Switch>
                          <Route path="/kacc/dashboard" component={KaccDashboard} />
                          <Route path="/kacc/b2b-gst" component={KaccB2BGst} />
                          <Route path="/kacc/b2c-nongst" component={KaccB2CNonGst} />
                          <Route path="/kacc/products" component={KaccProducts} />
                          <Route>
                            <Redirect to="/kacc/dashboard" />
                          </Route>
                        </Switch>
                      </KaccLayout>
                    </KaccGate>
                  </Route>

                  <Route path="/developer">
                    <Redirect to="/developer/dashboard" />
                  </Route>
                  <Route path="/developer/:rest*">
                    <Gate
                      storageKey="dev_authenticated"
                      passwordKey="dev_password"
                      title="Developer Console"
                      subtitle="Enter your security master password"
                      passwordPlaceholder="Security Password"
                      submitLabel="Authenticate"
                      loadingLabel="Verifying..."
                      domain="developer"
                    >
                      <DeveloperLayout>
                        <Switch>
                          <Route path="/developer/dashboard" component={DeveloperDashboard} />
                          <Route path="/developer/website" component={DeveloperWebsite} />
                          <Route path="/developer/passwords" component={DeveloperPasswords} />
                          <Route>
                            <Redirect to="/developer/dashboard" />
                          </Route>
                        </Switch>
                      </DeveloperLayout>
                    </Gate>
                  </Route>

                  <Route component={Fallback} />
                </Switch>
              </Suspense>
            </WouterRouter>
          </CartProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
