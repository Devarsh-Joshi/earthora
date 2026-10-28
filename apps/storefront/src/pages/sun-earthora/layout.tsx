import { useState, useEffect, useRef, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import {
  LayoutDashboard, Package, ShoppingCart, TrendingUp, LogOut, Leaf, ChevronRight,
  Inbox, Menu, X, Sparkles, Settings, AlertTriangle, PackageOpen, Phone, RefreshCw, MessageCircleQuestion
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";

const navItems = [
  { id: "dashboard",  label: "Dashboard",     icon: LayoutDashboard, path: "/sun-earthora/dashboard", hint: "Overview & key metrics" },
  { id: "products",   label: "Products",       icon: Package,         path: "/sun-earthora/products", hint: "Manage inventory & listings" },
  { id: "orders",     label: "Orders",         icon: ShoppingCart,    path: "/sun-earthora/orders", hint: "View & fulfill customer orders" },
  { id: "assistant-knowledge", label: "Agent Knowledge", icon: MessageCircleQuestion, path: "/sun-earthora/assistant-knowledge", hint: "Approved product answers for the chat assistant" },
  { id: "analytics", label: "Analytics",      icon: TrendingUp,      path: "/sun-earthora/analytics", hint: "Revenue & traffic trends" },
  { id: "settings",  label: "Settings",       icon: Settings,        path: "/sun-earthora/settings", hint: "Admin configuration" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifData, setNotifData] = useState<{ lowStock: any[]; pendingAlerts: any[]; restockRequests: any[] } | null>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const activeTab = location.replace("/sun-earthora/", "").replace("/sun-earthora", "") || "dashboard";

  useEffect(() => {
    async function fetchNotifications() {
      try {
        const [invRes, smsRes, restockRes] = await Promise.all([
          supabase.from("inventory").select("id, total_stock, low_stock_threshold, product_id"),
          supabase.from("sms_alert_logs").select("id, product_name, stock_at_alert, status, created_at").order("created_at", { ascending: false }).limit(20),
          supabase.from("customer_restock_requests").select("id, product_id, customer_phone, status, created_at").eq("status", "waiting").order("created_at", { ascending: false }).limit(20),
        ]);

        const inventory = invRes.data ?? [];
        const lowStock = inventory.filter((i: any) => i.total_stock <= i.low_stock_threshold);

        setNotifData({
          lowStock,
          pendingAlerts: (smsRes.data ?? []).filter((a: any) => a.status === "pending"),
          restockRequests: restockRes.data ?? [],
        });
      } catch {
        // silent fail — tray stays empty
      }
    }
    fetchNotifications();
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-primary text-primary-foreground">
      <div className="flex items-center h-20 px-6 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shadow-inner">
            <Leaf className="w-5 h-5 text-accent" strokeWidth={2} />
          </div>
          <div>
            <span className="font-serif text-lg font-bold tracking-tight text-white block">Earthora</span>
            <span className="text-[10px] text-white/40 font-medium tracking-wider uppercase">Console Panel</span>
          </div>
        </div>
      </div>

      <nav className="flex-1 py-6 px-4 space-y-1.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setLocation(item.path);
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-300 relative group ${
                isActive
                  ? "text-primary bg-[#fafaf8] shadow-md"
                  : "text-white/70 hover:text-white hover:bg-white/5"
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="activeBar"
                  className="absolute left-0 top-1/4 bottom-1/4 w-1 rounded-r-full bg-primary"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <item.icon className={`w-[18px] h-[18px] transition-transform duration-300 group-hover:scale-110 ${isActive ? "text-primary" : "text-white/60"}`} strokeWidth={1.75} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-white/10 bg-black/10">
        <div className="flex items-center gap-3 px-3 py-2.5 mb-2 rounded-xl bg-white/5">
          <div className="w-9 h-9 rounded-full bg-accent flex items-center justify-center text-xs font-bold text-primary shadow-md">
            A
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-white truncate">Administrator</p>
            <p className="text-[10px] text-white/40 truncate">admin@earthora.com</p>
          </div>
        </div>
        <button
          onClick={() => {
            sessionStorage.removeItem("admin_authenticated");
            sessionStorage.removeItem("admin_password");
            localStorage.removeItem("admin_session");
            toast({ title: "Signed Out", description: "You have been logged out of the session." });
            setLocation("/");
          }}
          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-white/60 hover:text-white hover:bg-white/5 transition-all"
        >
          <LogOut className="w-[17px] h-[17px] text-white/40" strokeWidth={1.75} />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-[100dvh] flex bg-[#fafaf8] text-foreground selection:bg-primary/20">
      <aside className="hidden lg:block w-64 bg-primary shrink-0 relative z-30 shadow-xl">
        <div className="sticky top-0 h-screen flex flex-col">
          <SidebarContent />
        </div>
      </aside>

      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileMenuOpen(false)}
              className="fixed inset-0 bg-black/60 z-40 lg:hidden backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="fixed top-0 bottom-0 left-0 w-64 bg-primary z-50 lg:hidden flex flex-col shadow-2xl"
            >
              <SidebarContent />
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="absolute top-5 right-4 p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <main className="flex-1 flex flex-col min-h-screen min-w-0">
        <header className="h-20 bg-white border-b border-border/30 flex items-center justify-between px-6 md:px-10 sticky top-0 z-20 shadow-sm shrink-0">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-xl hover:bg-muted text-foreground/60 transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-base font-serif text-foreground font-semibold capitalize leading-tight">{activeTab}</h1>
              <div className="flex items-center gap-1.5 text-xs text-foreground/30 mt-0.5">
                <span>Console</span>
                <ChevronRight className="w-3 h-3" strokeWidth={1.5} />
                <span className="text-foreground/50">{activeTab}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div ref={notifRef} className="relative">
              <button
                onClick={() => setNotifOpen(!notifOpen)}
                className="relative p-2 rounded-xl hover:bg-[#fafaf8] transition-colors"
              >
                {notifData && (notifData.lowStock.length + notifData.pendingAlerts.length + notifData.restockRequests.length > 0) && (
                  <div className="w-2 h-2 rounded-full bg-accent absolute top-1 right-1 ring-2 ring-white" />
                )}
                <Inbox className="w-5 h-5 text-foreground/50 hover:text-foreground transition-colors" strokeWidth={1.5} />
              </button>

              <AnimatePresence>
                {notifOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.96 }}
                    transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl border border-border/40 shadow-[0_8px_40px_rgba(0,0,0,0.08)] overflow-hidden z-50"
                  >
                    <div className="p-4 pb-0">
                      <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
                    </div>
                    <div className="max-h-96 overflow-y-auto p-2">
                      {!notifData ? (
                        <div className="flex items-center justify-center py-8">
                          <RefreshCw className="w-4 h-4 text-foreground/20 animate-spin" />
                        </div>
                      ) : notifData.lowStock.length === 0 && notifData.pendingAlerts.length === 0 && notifData.restockRequests.length === 0 ? (
                        <div className="text-center py-8">
                          <Inbox className="w-8 h-8 text-foreground/10 mx-auto mb-2" strokeWidth={1} />
                          <p className="text-xs text-foreground/30">All clear — no notifications</p>
                        </div>
                      ) : (
                        <>
                          {notifData.lowStock.length > 0 && (
                            <div className="mb-2">
                              <div className="flex items-center gap-1.5 px-3 py-1.5">
                                <AlertTriangle className="w-3 h-3 text-amber-500" strokeWidth={2} />
                                <span className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider">Low Stock</span>
                                <span className="ml-auto text-[10px] text-foreground/30">{notifData.lowStock.length} items</span>
                              </div>
                              {notifData.lowStock.slice(0, 5).map((item: any) => (
                                <button
                                  key={item.id}
                                  onClick={() => { setLocation("/sun-earthora/products"); setNotifOpen(false); }}
                                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[#fafaf8] transition-colors text-left"
                                >
                                  <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                                    <PackageOpen className="w-3.5 h-3.5 text-amber-500" strokeWidth={1.5} />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs font-medium text-foreground truncate">Product ID: {item.product_id?.slice(0, 8)}…</p>
                                    <p className="text-[10px] text-foreground/40">Stock: {item.total_stock} / threshold: {item.low_stock_threshold}</p>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}

                          {notifData.restockRequests.length > 0 && (
                            <div className="mb-2">
                              <div className="flex items-center gap-1.5 px-3 py-1.5">
                                <Phone className="w-3 h-3 text-blue-500" strokeWidth={2} />
                                <span className="text-[11px] font-semibold text-blue-600 uppercase tracking-wider">Restock Requests</span>
                                <span className="ml-auto text-[10px] text-foreground/30">{notifData.restockRequests.length} waiting</span>
                              </div>
                              {notifData.restockRequests.slice(0, 5).map((req: any) => (
                                <button
                                  key={req.id}
                                  onClick={() => { setLocation("/sun-earthora/products"); setNotifOpen(false); }}
                                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[#fafaf8] transition-colors text-left"
                                >
                                  <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                                    <Phone className="w-3.5 h-3.5 text-blue-500" strokeWidth={1.5} />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs font-medium text-foreground truncate">{req.customer_phone}</p>
                                    <p className="text-[10px] text-foreground/40">Since {new Date(req.created_at).toLocaleDateString()}</p>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}

                          {notifData.pendingAlerts.length > 0 && (
                            <div>
                              <div className="flex items-center gap-1.5 px-3 py-1.5">
                                <RefreshCw className="w-3 h-3 text-purple-500" strokeWidth={2} />
                                <span className="text-[11px] font-semibold text-purple-600 uppercase tracking-wider">Pending Alerts</span>
                                <span className="ml-auto text-[10px] text-foreground/30">{notifData.pendingAlerts.length} pending</span>
                              </div>
                              {notifData.pendingAlerts.slice(0, 5).map((alert: any) => (
                                <div key={alert.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl">
                                  <div className="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center shrink-0">
                                    <RefreshCw className="w-3.5 h-3.5 text-purple-500" strokeWidth={1.5} />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs font-medium text-foreground truncate">{alert.product_name}</p>
                                    <p className="text-[10px] text-foreground/40">Stock: {alert.stock_at_alert} — {new Date(alert.created_at).toLocaleDateString()}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <div className="p-2 border-t border-border/20">
                      <button
                        onClick={() => { setLocation("/sun-earthora/dashboard"); setNotifOpen(false); }}
                        className="w-full py-2 text-xs font-medium text-foreground/50 hover:text-foreground transition-colors text-center"
                      >
                        View Dashboard
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <span className="text-foreground/15">|</span>
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-full bg-primary/5 border border-primary/10 flex items-center justify-center p-0.5">
                <div className="w-full h-full rounded-full bg-primary flex items-center justify-center text-xs font-bold text-white shadow-inner">
                  A
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 p-6 md:p-10 max-w-7xl w-full mx-auto">
          <Suspense fallback={
            <div className="flex items-center justify-center h-48">
              <div className="flex flex-col items-center gap-3">
                <div className="w-7 h-7 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                <span className="text-xs text-foreground/30 font-medium">Loading…</span>
              </div>
            </div>
          }>
            {children}
          </Suspense>
        </div>
      </main>
    </div>
  );
}
