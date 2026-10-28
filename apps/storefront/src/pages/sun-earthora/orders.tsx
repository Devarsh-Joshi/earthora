import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Filter, ChevronRight, Clock, RefreshCw, PackageOpen, Plus, User, Package, X, Check, Minus, Mail, Phone, Building, MapPin, Link2, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { createOrderId } from "@/lib/order-id";
import { useToast } from "@/hooks/use-toast";
import { useEscapeKey } from "@/hooks/useEscapeKey";

function statusBadge(status: string) {
  const map: Record<string, string> = {
    delivered: "bg-emerald-50 text-emerald-700 border-emerald-200/80 shadow-xs",
    out_for_delivery: "bg-sky-50 text-sky-700 border-sky-200/80 shadow-xs",
    processing: "bg-indigo-50 text-indigo-700 border-indigo-200/80 shadow-xs",
  };
  const normalized = status?.toLowerCase() || "processing";
  return `px-3 py-1 rounded-xl text-[11px] font-bold border capitalize transition-all duration-200 inline-flex items-center gap-1.5 ${map[normalized] || map.processing}`;
}

const ALL_STATUSES = [
  { id: "processing", label: "Processing", color: "bg-indigo-500" },
  { id: "out_for_delivery", label: "Out for delivery", color: "bg-sky-500" },
  { id: "delivered", label: "Delivered", color: "bg-emerald-500" },
];

function orderStatusLabel(status: string) {
  return ALL_STATUSES.find((item) => item.id === status)?.label || "Processing";
}

function displayOrderStatus(status: unknown, trackingSentAt?: string | null) {
  const normalized = String(status || "").toLowerCase().replace(/-/g, "_");
  if (normalized === "delivered") return "delivered";
  if (trackingSentAt || ["out_for_delivery", "shipped", "packed", "ready_for_shipment"].includes(normalized)) {
    return "out_for_delivery";
  }
  return "processing";
}

function displayOrderSource(shipping: Record<string, any>, userId: unknown) {
  const rawSource = String(shipping.source || "").toLowerCase();
  const rawUserId = String(userId || "").toLowerCase();
  if (rawSource.includes("whatsapp") || rawUserId.startsWith("whatsapp:")) return "whatsapp";
  if (rawSource.includes("voice") || rawSource.includes("smartflo")) return "voice_agent";
  if (rawSource.includes("offline") || rawSource.includes("manual")) return "offline";
  return "website";
}

function orderSourceLabel(source: string) {
  if (source === "voice_agent") return "Voice agent";
  if (source === "whatsapp") return "WhatsApp";
  if (source === "offline") return "Offline order";
  return "Website";
}

interface ProductItem {
  id: string;
  name: string;
  price: number;
}

interface OrderLineItem {
  productId: string;
  quantity: number;
  unitPrice: number;
}

export default function AdminOrders() {
  const [orders, setOrders] = useState<any[]>([]);
  const [filtered, setFiltered] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [availableProducts, setAvailableProducts] = useState<ProductItem[]>([]);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [activeStatusMenuId, setActiveStatusMenuId] = useState<string | null>(null);
  const [trackingLinkDraft, setTrackingLinkDraft] = useState("");
  const [sendingTrackingId, setSendingTrackingId] = useState<string | null>(null);
  const { toast } = useToast();

  // New offline order form state — taking all checkout fields including GST Number
  const [manualForm, setManualForm] = useState({
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    country: "India",
    gstNumber: "",
    paymentStatus: "completed",
    orderStatus: "processing",
  });
  const [orderItems, setOrderItems] = useState<OrderLineItem[]>([]);

  useEscapeKey(() => setSelectedOrder(null), !!selectedOrder);
  useEscapeKey(() => setShowAddModal(false), showAddModal);
  useEscapeKey(() => setActiveStatusMenuId(null), !!activeStatusMenuId);

  // Fetch available products for manual creation
  const fetchAvailableProducts = async () => {
    try {
      const { data } = await supabase.from("products").select("id, name, price").neq("status", "archived");
      if (data) {
        setAvailableProducts(data.map((p: any) => ({ id: p.id, name: p.name, price: Number(p.price || 0) })));
      }
    } catch (e) {
      console.error("Error fetching products:", e);
    }
  };

  const fetchOrders = async () => {
    try {
      const orderSelect = (includeTracking: boolean) => supabase
        .from("orders")
        .select(`
          id,
          order_number,
          user_id,
          shipping_address,
          customer_name,
          customer_email,
          customer_phone,
          customer_address,
          customer_city,
          customer_state,
          customer_zip,
          customer_country,
          customer_gst,
          ${includeTracking ? "tracking_url, tracking_sent_at," : ""}
          status,
          total_amount,
          created_at,
          order_items (
            id,
            quantity,
            unit_price,
            total_price,
            product_id,
            products (
              id,
              name,
              slug,
              images
            )
          )
        `)
        .order("created_at", { ascending: false });

      let { data, error } = await orderSelect(true);
      // Keep the existing orders view usable while an older production
      // database is waiting for the tracking migration to be applied.
      if (error && /tracking_(url|sent_at).*does not exist/i.test(error.message || "")) {
        ({ data, error } = await orderSelect(false));
      }

      if (error) throw error;

      const mapped = (data || []).map((o: any) => {
        let shipping = o.shipping_address || {};
        if (typeof shipping === "string") {
          try { shipping = JSON.parse(shipping); } catch { shipping = {}; }
        }
        const itemsList = (o.order_items || []).map((item: any) => ({
          id: item.id,
          product_id: item.product_id,
          name: item.products?.name || item.product_id || "Moringa Product",
          quantity: Number(item.quantity || 1),
          unit_price: Number(item.unit_price || 0),
          total_price: Number(item.total_price || (item.unit_price * item.quantity) || 0),
          image: item.products?.images?.[0]?.url || "",
        }));

        const itemsCount = itemsList.reduce(
          (acc: number, item: any) => acc + (item.quantity || 0),
          0
        );

        return {
          id: o.id,
          orderNumber: o.order_number || o.id,
          customer: shipping.name || o.customer_name || shipping.email || o.id,
          email: shipping.email || o.customer_email || "",
          phone: shipping.phone || o.customer_phone || "",
          address: shipping.address || o.customer_address || "",
          city: shipping.city || o.customer_city || "",
          state: shipping.state || o.customer_state || "",
          zip: shipping.zip || shipping.postalCode || o.customer_zip || "",
          country: shipping.country || o.customer_country || "India",
          gstNumber: shipping.gst || o.customer_gst || shipping.gstNumber || "",
          trackingUrl: o.tracking_url || "",
          trackingSentAt: o.tracking_sent_at || null,
          items: itemsCount,
          itemsList,
          total: Number(o.total_amount || 0),
          source: displayOrderSource(shipping, o.user_id),
          status: displayOrderStatus(o.status, o.tracking_sent_at),
          date: new Date(o.created_at || Date.now()).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
        };
      });

      setOrders(mapped);
      setFiltered(mapped);
    } catch (err: any) {
      console.error("Orders fetch error:", err);
      toast({
        title: "Fetch failed",
        description: err.message || "Failed to load orders.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!search.trim()) {
      setFiltered(orders);
    } else {
      const q = search.toLowerCase();
      setFiltered(
        orders.filter(
          (o) =>
            o.customer.toLowerCase().includes(q) ||
            o.orderNumber.toLowerCase().includes(q) ||
            o.email.toLowerCase().includes(q) ||
            o.status.toLowerCase().includes(q) ||
            (o.gstNumber && o.gstNumber.toLowerCase().includes(q))
        )
      );
    }
  }, [search, orders]);

  const updateOrderStatus = async (orderId: string, nextStatus: string) => {
    setActiveStatusMenuId(null);
    setUpdatingId(orderId);
    try {
      const { error } = await (supabase
        .from("orders") as any)
        .update({ status: nextStatus })
        .eq("id", orderId);

      if (error) throw error;

      await (supabase.from("Order_history") as any).insert({
        order_id: orderId,
        order_status: nextStatus,
      });

      toast({ title: "Order status updated", description: `Changed to ${nextStatus}.` });
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: nextStatus } : o))
      );
      if (selectedOrder && selectedOrder.id === orderId) {
        setSelectedOrder((prev: any) => ({ ...prev, status: nextStatus }));
      }
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    } finally {
      setUpdatingId(null);
    }
  };

  const sendTrackingUpdate = async () => {
    if (!selectedOrder) return;
    const trackingUrl = trackingLinkDraft.trim();
    if (!/^https?:\/\//i.test(trackingUrl)) {
      toast({ title: "Invalid tracking link", description: "Enter a complete HTTP(S) courier tracking URL.", variant: "destructive" });
      return;
    }

    setSendingTrackingId(selectedOrder.id);
    try {
      const { data, error } = await supabase.functions.invoke("send-order-tracking", {
        body: { orderId: selectedOrder.id, trackingUrl },
        headers: { "x-admin-password": sessionStorage.getItem("admin_password") || "" },
      });
      if (error || data?.ok !== true) throw error || new Error(data?.error || "Tracking delivery failed");

      const sentAt = data.trackingSentAt || new Date().toISOString();
      const update = {
        trackingUrl,
        trackingSentAt: sentAt,
        status: data.status || (selectedOrder.status === "delivered" ? "delivered" : "out_for_delivery"),
      };
      setOrders((prev) => prev.map((o) => o.id === selectedOrder.id ? { ...o, ...update } : o));
      setFiltered((prev) => prev.map((o) => o.id === selectedOrder.id ? { ...o, ...update } : o));
      setSelectedOrder((prev: any) => prev ? { ...prev, ...update } : prev);
      toast({ title: "Tracking sent", description: "The tracking link was saved and emailed to the customer." });
    } catch (err: any) {
      toast({ title: "Tracking not sent", description: err.message || "Could not deliver the tracking link.", variant: "destructive" });
    } finally {
      setSendingTrackingId(null);
    }
  };

  useEffect(() => {
    fetchOrders();
    fetchAvailableProducts();

    const channel = supabase
      .channel("orders-admin-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        fetchOrders();
      })
      .subscribe();

    // Fallback when Supabase Realtime publication is not enabled or reconnecting.
    const refresh = window.setInterval(() => { if (!document.hidden) fetchOrders(); }, 15000);
    return () => { window.clearInterval(refresh); supabase.removeChannel(channel); };
  }, []);

  const handleCreateOfflineOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualForm.customerName || orderItems.length === 0) {
      toast({ title: "Missing fields", description: "Customer name and at least one product are required.", variant: "destructive" });
      return;
    }

    setCreatingOrder(true);
    try {
      const totalAmount = orderItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
      const orderId = createOrderId("offline");
      const customerEmail = manualForm.customerEmail || `offline_${Date.now()}@earthorafarms.com`;

      const shippingAddress = {
        name: manualForm.customerName,
        email: customerEmail,
        phone: manualForm.customerPhone,
        address: manualForm.address,
        city: manualForm.city,
        state: manualForm.state,
        zip: manualForm.zip,
        country: manualForm.country || "India",
        gst: manualForm.gstNumber || "",
        source: "offline",
      };

      // 1. Update/Insert User_details
      await (supabase.from("User_details") as any).upsert({
        user_email: customerEmail,
        user_name: manualForm.customerName,
        user_phone: manualForm.customerPhone,
        user_address: manualForm.address,
        user_city: manualForm.city,
        user_state: manualForm.state,
        user_zip: manualForm.zip,
        user_country: manualForm.country || "India",
        user_gst: manualForm.gstNumber || "",
      }, { onConflict: "user_email" });

      // 2. Insert normalized order row
      const { error: orderErr } = await (supabase.from("orders") as any).insert({
        id: orderId,
        order_number: orderId,
        user_id: customerEmail,
        status: manualForm.orderStatus || "processing",
        total_amount: totalAmount,
        shipping_address: shippingAddress,
        customer_name: manualForm.customerName,
        customer_email: customerEmail,
        customer_phone: manualForm.customerPhone,
        customer_address: manualForm.address,
        customer_city: manualForm.city,
        customer_state: manualForm.state,
        customer_zip: manualForm.zip,
        customer_country: manualForm.country || "India",
        customer_gst: manualForm.gstNumber || "",
      });

      if (orderErr) throw orderErr;

      // 3. Insert all order_items rows
      await (supabase.from("order_items") as any).insert(
        orderItems.map((item) => ({
          order_id: orderId,
          product_id: item.productId,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          total_price: item.unitPrice * item.quantity,
        }))
      );

      // 4. Insert payment record
      await (supabase.from("Payments") as any).insert({
        payment_order_id: orderId,
        payment_amount: String(totalAmount),
        payment_status: manualForm.paymentStatus || "completed",
        payment_method: "OFFLINE / CASH",
        payment_transaction_id: `POS-${Date.now()}`,
      });

      // 5. Insert order history record
      await (supabase.from("Order_history") as any).insert({
        order_id: orderId,
        order_status: manualForm.orderStatus || "delivered",
      });

      toast({ title: "Offline order created!", description: `Order #${orderId} saved to database.` });
      setShowAddModal(false);
      setOrderItems([]);
      setManualForm({
        customerName: "",
        customerEmail: "",
        customerPhone: "",
        address: "",
        city: "",
        state: "",
        zip: "",
        country: "India",
        gstNumber: "",
        paymentStatus: "completed",
        orderStatus: "processing",
      });
      fetchOrders();
    } catch (err: any) {
      console.error("Offline order creation error:", err);
      toast({ title: "Failed to create order", description: err.message || "Error saving offline order.", variant: "destructive" });
    } finally {
      setCreatingOrder(false);
    }
  };

  return (
    <>
      <motion.div
        key="orders"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -12 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground/30" strokeWidth={1.5} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, order ID, GSTIN..."
                className="h-11 pl-10 pr-4 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all w-72 placeholder:text-foreground/30"
              />
            </div>
            <button className="h-11 px-3.5 rounded-xl border border-border/40 bg-white text-foreground/50 hover:text-foreground hover:border-border/60 hover:bg-muted/10 transition-all">
              <Filter className="w-4 h-4" strokeWidth={1.5} />
            </button>
            <span className="text-xs text-foreground/30 ml-2">
              {filtered.length} order{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowAddModal(true)}
              className="h-11 px-4 rounded-xl bg-primary text-primary-foreground font-semibold text-xs shadow-md shadow-primary/20 hover:bg-primary/90 transition-all flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>Create Offline Order</span>
            </button>
            <div className="flex items-center gap-2 text-xs text-foreground/40 font-medium">
              <Clock className="w-3.5 h-3.5" strokeWidth={1.5} />
              <span>Live updates on</span>
              <button
                onClick={() => { setLoading(true); fetchOrders(); }}
                className="p-1 rounded hover:bg-muted ml-1 transition-colors"
                title="Reload orders"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
              <p className="text-xs text-foreground/30">Loading orders...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20 bg-white border border-border/40 rounded-2xl">
              <PackageOpen className="w-10 h-10 text-foreground/10 mx-auto mb-3" strokeWidth={1} />
              <p className="text-sm font-medium text-foreground/40">
                {search ? "No orders match your search." : "No orders yet."}
              </p>
              {search && (
                <button onClick={() => setSearch("")} className="mt-2 text-xs text-primary hover:underline">
                  Clear search
                </button>
              )}
            </div>
          ) : (
            filtered.map((order, i) => (
              <motion.div
                key={order.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: i * 0.04 }}
                className="group/ord relative overflow-visible rounded-[26px] border border-border/50 bg-white shadow-[0_8px_28px_rgba(26,56,38,0.04)] transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[0_16px_40px_rgba(26,56,38,0.10)] cursor-pointer"
                onClick={() => { setSelectedOrder(order); setTrackingLinkDraft(order.trackingUrl || ""); }}
              >
                <div className="h-1 w-full rounded-t-[26px] bg-gradient-to-r from-primary via-primary/70 to-emerald-300" />
                <div className="p-5 pb-4 sm:p-6 sm:pb-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex min-w-0 items-center gap-3.5">
                      <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/8 text-sm font-bold text-primary ring-1 ring-primary/10 transition-colors duration-300 group-hover/ord:bg-primary group-hover/ord:text-white">
                        {order.customer.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
                        <span className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-white bg-emerald-400" title="Order received" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-[15px] font-bold tracking-[-0.01em] text-foreground">{order.customer}</h3>
                          <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] ${order.source === "whatsapp" ? "bg-emerald-50 text-emerald-700" : order.source === "voice_agent" ? "bg-violet-50 text-violet-700" : order.source === "offline" ? "bg-amber-50 text-amber-700" : "bg-primary/7 text-primary"}`}>
                            {orderSourceLabel(order.source)}
                          </span>
                          {order.gstNumber && (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-bold font-mono text-amber-700">GST {order.gstNumber}</span>
                          )}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-foreground/45">
                          <span className="rounded-md bg-muted/60 px-2 py-1 font-mono font-semibold text-foreground/60">#{order.orderNumber}</span>
                          <span className="text-border">•</span>
                          <span>{order.date}</span>
                          {order.email && <><span className="text-border">•</span><span className="max-w-[220px] truncate">{order.email}</span></>}
                          {order.phone && <><span className="text-border">•</span><span className="whitespace-nowrap">{order.phone}</span></>}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 lg:justify-end">
                      <div className="text-left lg:text-right">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/35">Order total</p>
                        <p className="mt-0.5 text-xl font-bold tracking-[-0.03em] text-primary">₹{order.total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
                      </div>

                      {/* Interactive status control */}
                  <div className="relative" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      disabled={updatingId === order.id}
                      onClick={() => setActiveStatusMenuId(activeStatusMenuId === order.id ? null : order.id)}
                      className="group/btn focus:outline-none"
                    >
                      {updatingId === order.id ? (
                        <span className="px-3 py-1 rounded-xl text-[11px] font-semibold border border-gray-200 bg-gray-50 text-gray-400 inline-flex items-center gap-1.5 shadow-xs">
                          <RefreshCw className="w-3 h-3 animate-spin text-primary" />
                          updating...
                        </span>
                      ) : (
                        <span className={statusBadge(order.status)}>
                          <span>{orderStatusLabel(order.status)}</span>
                          <ChevronRight className={`w-3 h-3 transition-transform duration-200 ${activeStatusMenuId === order.id ? "rotate-90 text-primary" : "rotate-0 text-foreground/40 group-hover/btn:text-foreground"}`} />
                        </span>
                      )}
                    </button>

                    {/* Status Selection Popover */}
                    <AnimatePresence>
                      {activeStatusMenuId === order.id && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95, y: -6 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95, y: -6 }}
                          transition={{ duration: 0.15 }}
                          className="absolute right-0 top-full mt-1.5 w-40 bg-white rounded-2xl shadow-xl border border-border/40 py-1.5 z-40 overflow-hidden font-sans"
                        >
                          <div className="px-3 py-1 text-[10px] font-bold text-foreground/40 uppercase tracking-wider border-b border-border/20 mb-1">
                            Select Status
                          </div>
                          {ALL_STATUSES.map((st) => {
                            const isCurrent = (order.status || "").toLowerCase() === st.id;
                            return (
                              <button
                                key={st.id}
                                type="button"
                                onClick={() => updateOrderStatus(order.id, st.id)}
                                className={`w-full px-3 py-1.5 text-left text-xs font-semibold flex items-center justify-between transition-colors ${
                                  isCurrent ? "bg-primary/10 text-primary" : "hover:bg-muted/40 text-foreground/80"
                                }`}
                              >
                                <span className="flex items-center gap-2">
                                  <span className={`w-2 h-2 rounded-full ${st.color}`} />
                                  {st.label}
                                </span>
                                {isCurrent && <Check className="w-3.5 h-3.5 text-primary" strokeWidth={2.5} />}
                              </button>
                            );
                          })}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                </div>
                </div>

                  <div className="mt-5 grid gap-3 border-t border-border/40 pt-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex shrink-0 -space-x-2">
                        {(order.itemsList || []).slice(0, 3).map((item: any, index: number) => (
                          <div key={item.id || index} className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border-2 border-white bg-[#f5f7f1] text-[10px] font-bold text-primary shadow-sm">
                            {item.image ? <img src={item.image} alt="" className="h-full w-full object-cover" /> : <Package className="h-4 w-4" strokeWidth={1.5} />}
                          </div>
                        ))}
                        {order.items > 3 && <div className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-white bg-primary/8 text-[10px] font-bold text-primary shadow-sm">+{order.items - 3}</div>}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/35">Items in order</p>
                        <p className="mt-0.5 truncate text-xs font-semibold text-foreground/75">
                          {order.itemsList?.length ? `${order.itemsList[0].name}${order.itemsList.length > 1 ? ` + ${order.itemsList.length - 1} more` : ""}` : "No item details available"}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-foreground/55 sm:border-l sm:border-border/40 sm:pl-5">
                      <Package className="h-3.5 w-3.5 text-primary/70" strokeWidth={1.6} />
                      <span><strong className="text-foreground">{order.items}</strong> unit{order.items !== 1 ? "s" : ""}</span>
                    </div>

                    <button
                      type="button"
                      disabled={!order.email}
                      title={order.email ? "Add or update shipment tracking" : "No email address on this order"}
                      onClick={(e) => { e.stopPropagation(); setSelectedOrder(order); setTrackingLinkDraft(order.trackingUrl || ""); }}
                      className={`inline-flex h-9 items-center justify-center gap-2 rounded-xl border px-3 text-[10px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${order.trackingSentAt ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border-sky-200 bg-sky-50/60 text-sky-700 hover:bg-sky-100"}`}
                    >
                      {order.trackingSentAt ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                      {order.trackingSentAt ? "Tracking sent" : "Add tracking"}
                    </button>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </motion.div>

      {/* ── Redesigned Record Offline / Manual Order Modal (NO SCROLLBAR) ── */}
      <AnimatePresence>
        {showAddModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setShowAddModal(false); setOrderItems([]); }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 15 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-4 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[720px] bg-white rounded-3xl shadow-2xl z-50 overflow-hidden flex flex-col border border-border/40 font-sans"
            >
              {/* Modal Header */}
              <div className="px-6 py-4 border-b border-border/30 flex items-center justify-between bg-muted/20 shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <Plus className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-foreground">Record Offline / Manual Order</h2>
                    <p className="text-[11px] text-foreground/50">Capture full customer checkout details & GSTIN and sync automatically</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="p-1.5 rounded-xl text-foreground/40 hover:text-foreground hover:bg-muted transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Form Content — Compact 2-Column Grid */}
              <form onSubmit={handleCreateOfflineOrder} className="p-5 flex flex-col gap-4 overflow-y-auto">
                
                {/* Section 1: Customer & Address Information (Checkout Fields) */}
                <div className="space-y-2">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-foreground/50 flex items-center gap-1">
                    <User className="w-3 h-3 text-primary" /> Customer & Shipping Info
                  </span>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                    <div>
                      <label className="block text-foreground/60 font-semibold text-[11px] mb-1">Full Name *</label>
                      <input
                        type="text"
                        required
                        placeholder="Rahul Sharma"
                        value={manualForm.customerName}
                        onChange={(e) => setManualForm({ ...manualForm, customerName: e.target.value })}
                        className="w-full h-9 px-3 rounded-xl border border-border/50 bg-[#fafaf8] outline-none focus:border-primary/50 text-foreground text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-foreground/60 font-semibold text-[11px] mb-1">Phone Number</label>
                      <input
                        type="text"
                        placeholder="+91 98765 43210"
                        value={manualForm.customerPhone}
                        onChange={(e) => setManualForm({ ...manualForm, customerPhone: e.target.value })}
                        className="w-full h-9 px-3 rounded-xl border border-border/50 bg-[#fafaf8] outline-none focus:border-primary/50 text-foreground text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-foreground/60 font-semibold text-[11px] mb-1">Email Address</label>
                      <input
                        type="email"
                        placeholder="customer@example.com"
                        value={manualForm.customerEmail}
                        onChange={(e) => setManualForm({ ...manualForm, customerEmail: e.target.value })}
                        className="w-full h-9 px-3 rounded-xl border border-border/50 bg-[#fafaf8] outline-none focus:border-primary/50 text-foreground text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-foreground/60 font-semibold text-[11px] mb-1">GST Number (Optional)</label>
                      <input
                        type="text"
                        placeholder="22AAAAA0000A1Z5"
                        value={manualForm.gstNumber}
                        onChange={(e) => setManualForm({ ...manualForm, gstNumber: e.target.value.toUpperCase() })}
                        className="w-full h-9 px-3 rounded-xl border border-border/50 bg-[#fafaf8] outline-none focus:border-primary/50 text-foreground text-xs uppercase"
                      />
                    </div>

                    <div className="col-span-2 sm:col-span-4 grid grid-cols-4 gap-2">
                      <div className="col-span-2">
                        <input
                          type="text"
                          placeholder="Street Address / Building"
                          value={manualForm.address}
                          onChange={(e) => setManualForm({ ...manualForm, address: e.target.value })}
                          className="w-full h-9 px-3 rounded-xl border border-border/50 bg-[#fafaf8] outline-none focus:border-primary/50 text-foreground text-xs"
                        />
                      </div>
                      <div>
                        <input
                          type="text"
                          placeholder="City"
                          value={manualForm.city}
                          onChange={(e) => setManualForm({ ...manualForm, city: e.target.value })}
                          className="w-full h-9 px-3 rounded-xl border border-border/50 bg-[#fafaf8] outline-none focus:border-primary/50 text-foreground text-xs"
                        />
                      </div>
                      <div>
                        <input
                          type="text"
                          placeholder="State"
                          value={manualForm.state}
                          onChange={(e) => setManualForm({ ...manualForm, state: e.target.value })}
                          className="w-full h-9 px-3 rounded-xl border border-border/50 bg-[#fafaf8] outline-none focus:border-primary/50 text-foreground text-xs"
                        />
                      </div>
                    </div>

                    <div className="col-span-2 sm:col-span-4 grid grid-cols-2 gap-2">
                      <div>
                        <input
                          type="text"
                          placeholder="Pincode / Postal Code"
                          value={manualForm.zip}
                          onChange={(e) => setManualForm({ ...manualForm, zip: e.target.value })}
                          className="w-full h-9 px-3 rounded-xl border border-border/50 bg-[#fafaf8] outline-none focus:border-primary/50 text-foreground text-xs"
                        />
                      </div>
                      <div>
                        <input
                          type="text"
                          placeholder="Country"
                          value={manualForm.country}
                          onChange={(e) => setManualForm({ ...manualForm, country: e.target.value })}
                          className="w-full h-9 px-3 rounded-xl border border-border/50 bg-[#fafaf8] outline-none focus:border-primary/50 text-foreground text-xs"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section 2: Product & Order Setup */}
                <div className="space-y-2 pt-2 border-t border-border/20">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-foreground/50 flex items-center gap-1">
                    <Package className="w-3 h-3 text-primary" /> Products ({orderItems.length} selected)
                  </span>

                  {/* Multi-select Product Pills */}
                  <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
                    {availableProducts.map((p) => {
                      const lineItem = orderItems.find((i) => i.productId === p.id);
                      const isSelected = !!lineItem;
                      return (
                        <div
                          key={p.id}
                          className={`p-2.5 rounded-xl border text-left transition-all ${
                            isSelected
                              ? "bg-primary/10 border-primary shadow-xs ring-1 ring-primary/30"
                              : "bg-white border-border/30 hover:border-primary/30 hover:bg-muted/20"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              if (isSelected) {
                                setOrderItems((prev) => prev.filter((i) => i.productId !== p.id));
                              } else {
                                setOrderItems((prev) => [...prev, { productId: p.id, quantity: 1, unitPrice: p.price }]);
                              }
                            }}
                            className="w-full flex items-center justify-between mb-1"
                          >
                            <div className="min-w-0 pr-1 text-left">
                              <p className={`text-xs font-bold truncate ${isSelected ? "text-primary" : "text-foreground"}`}>
                                {p.name}
                              </p>
                              <span className="text-[10px] text-foreground/50 font-medium">₹{p.price.toLocaleString("en-IN")}</span>
                            </div>
                            {isSelected
                              ? <Check className="w-3.5 h-3.5 text-primary shrink-0" strokeWidth={3} />
                              : <Plus className="w-3.5 h-3.5 text-foreground/30 shrink-0" strokeWidth={2} />
                            }
                          </button>
                          {isSelected && (
                            <div className="flex items-center gap-1 mt-1.5 pt-1.5 border-t border-primary/20">
                              <button
                                type="button"
                                onClick={() => setOrderItems((prev) => prev.map((i) => i.productId === p.id ? { ...i, quantity: Math.max(1, i.quantity - 1) } : i))}
                                className="w-6 h-6 rounded-lg bg-primary/15 text-primary flex items-center justify-center hover:bg-primary/25 transition-colors"
                              >
                                <Minus className="w-3 h-3" strokeWidth={2.5} />
                              </button>
                              <input
                                type="number"
                                min="1"
                                value={lineItem.quantity}
                                onChange={(e) => {
                                  const qty = Math.max(1, parseInt(e.target.value) || 1);
                                  setOrderItems((prev) => prev.map((i) => i.productId === p.id ? { ...i, quantity: qty } : i));
                                }}
                                className="flex-1 h-6 text-center text-xs font-bold text-primary bg-primary/5 rounded-lg border border-primary/20 outline-none w-0"
                              />
                              <button
                                type="button"
                                onClick={() => setOrderItems((prev) => prev.map((i) => i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i))}
                                className="w-6 h-6 rounded-lg bg-primary/15 text-primary flex items-center justify-center hover:bg-primary/25 transition-colors"
                              >
                                <Plus className="w-3 h-3" strokeWidth={2.5} />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <label className="block text-foreground/60 font-semibold text-[10px] mb-1">Payment Status</label>
                      <select
                        value={manualForm.paymentStatus}
                        onChange={(e) => setManualForm({ ...manualForm, paymentStatus: e.target.value })}
                        className="w-full h-9 px-2 rounded-xl border border-border/50 bg-[#fafaf8] outline-none focus:border-primary/50 text-foreground text-xs"
                      >
                        <option value="completed">Completed (Paid)</option>
                        <option value="pending">Pending</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-foreground/60 font-semibold text-[10px] mb-1">Order Status</label>
                      <select
                        value={manualForm.orderStatus}
                        onChange={(e) => setManualForm({ ...manualForm, orderStatus: e.target.value })}
                        className="w-full h-9 px-2 rounded-xl border border-border/50 bg-[#fafaf8] outline-none focus:border-primary/50 text-foreground text-xs capitalize"
                      >
                        <option value="processing">Processing</option>
                        <option value="out_for_delivery">Out for delivery</option>
                        <option value="delivered">Delivered</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Total & Action Bar */}
                <div className="pt-3 border-t border-border/30 flex items-center justify-between shrink-0">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-foreground/40 block">
                      Total · {orderItems.reduce((s, i) => s + i.quantity, 0)} item{orderItems.reduce((s, i) => s + i.quantity, 0) !== 1 ? "s" : ""}
                    </span>
                    <span className="text-lg font-black text-primary">
                      ₹{orderItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0).toLocaleString("en-IN")}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { setShowAddModal(false); setOrderItems([]); }}
                      className="px-4 py-2 rounded-xl border border-border/50 text-xs font-semibold text-foreground/60 hover:bg-muted transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={creatingOrder}
                      className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shadow-md shadow-primary/20 flex items-center gap-2"
                    >
                      {creatingOrder ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-4 h-4" />}
                      Save Offline Order
                    </button>
                  </div>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Order Details Modal Popup ── */}
      <AnimatePresence>
        {selectedOrder && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedOrder(null)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            />

            {/* Centered Modal Container */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-4 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[600px] sm:max-h-[90vh] bg-white rounded-3xl shadow-2xl z-50 overflow-hidden flex flex-col border border-border/40 font-sans"
            >
              {/* Header */}
              <div className="px-6 py-5 border-b border-border/30 flex items-center justify-between bg-muted/20">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-foreground">
                      Order #{selectedOrder.orderNumber}
                    </h2>
                    <span className={statusBadge(selectedOrder.status)}>
                      {orderStatusLabel(selectedOrder.status)}
                    </span>
                  </div>
                  <p className="text-xs text-foreground/40 mt-0.5">Placed on {selectedOrder.date}</p>
                </div>
                <button
                  onClick={() => setSelectedOrder(null)}
                  className="p-2 rounded-xl text-foreground/40 hover:text-foreground hover:bg-muted transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Scrollable Content */}
              <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-140px)]">

                {/* Customer Information Card */}
                <div className="bg-[#FAF9F5] p-4.5 rounded-2xl border border-border/30 space-y-3">
                  <h3 className="text-xs uppercase tracking-wider font-bold text-foreground/50 flex items-center gap-2">
                    <User className="w-3.5 h-3.5 text-primary" />
                    Customer Information
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-foreground/40 font-medium">Name</p>
                      <p className="font-semibold text-foreground mt-0.5">{selectedOrder.customer}</p>
                    </div>

                    {selectedOrder.email && (
                      <div>
                        <p className="text-foreground/40 font-medium flex items-center gap-1">
                          <Mail className="w-3 h-3 text-foreground/30" /> Email
                        </p>
                        <p className="font-medium text-foreground mt-0.5 truncate">{selectedOrder.email}</p>
                      </div>
                    )}

                    {selectedOrder.phone && (
                      <div>
                        <p className="text-foreground/40 font-medium flex items-center gap-1">
                          <Phone className="w-3 h-3 text-foreground/30" /> Phone
                        </p>
                        <p className="font-medium text-foreground mt-0.5">{selectedOrder.phone}</p>
                      </div>
                    )}

                    {selectedOrder.gstNumber && (
                      <div>
                        <p className="text-foreground/40 font-medium flex items-center gap-1">
                          <Building className="w-3 h-3 text-foreground/30" /> GSTIN / GST Number
                        </p>
                        <p className="font-semibold font-mono text-foreground mt-0.5 uppercase">{selectedOrder.gstNumber}</p>
                      </div>
                    )}

                    <div className="sm:col-span-2">
                      <p className="text-foreground/40 font-medium flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-foreground/30" /> Shipping Address
                      </p>
                      <p className="font-medium text-foreground/80 mt-0.5">
                        {selectedOrder.address
                          ? `${selectedOrder.address}, ${selectedOrder.city} ${selectedOrder.state} - ${selectedOrder.zip}, ${selectedOrder.country}`
                          : "Primary Shipping Address"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Items Ordered Breakdown */}
                <div className="space-y-3">
                  <h3 className="text-xs uppercase tracking-wider font-bold text-foreground/50 flex items-center gap-2">
                    <Package className="w-3.5 h-3.5 text-primary" />
                    Ordered Items ({selectedOrder.items} unit{selectedOrder.items !== 1 ? "s" : ""})
                  </h3>

                  <div className="space-y-2">
                    {(selectedOrder.itemsList || []).map((item: any, idx: number) => (
                      <div
                        key={item.id || idx}
                        className="flex items-center justify-between p-3 rounded-xl bg-white border border-border/40 shadow-xs text-xs"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary font-bold text-xs flex items-center justify-center shrink-0">
                            {item.quantity}x
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-foreground truncate">{item.name}</p>
                            <p className="text-foreground/40 text-[11px] mt-0.5">
                              Unit Price: ₹{item.unit_price.toLocaleString("en-IN")}
                            </p>
                          </div>
                        </div>

                        <span className="font-bold text-foreground shrink-0 ml-3">
                          ₹{item.total_price.toLocaleString("en-IN")}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Shipment Tracking */}
                <div className="bg-sky-50/60 p-4 rounded-2xl border border-sky-100 space-y-3">
                  <h3 className="text-xs uppercase tracking-wider font-bold text-sky-800/70 flex items-center gap-2">
                    <Link2 className="w-3.5 h-3.5 text-sky-600" />
                    Shipment Tracking
                  </h3>
                  <p className="text-[11px] text-foreground/50">
                    Save the courier link and email it to the customer.
                    {selectedOrder.trackingSentAt ? " You can send an updated link again." : ""}
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="url"
                      value={trackingLinkDraft}
                      onChange={(e) => setTrackingLinkDraft(e.target.value)}
                      placeholder="https://courier.example/track/..."
                      className="flex-1 h-10 px-3 text-xs bg-white border border-sky-200 rounded-xl outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                    />
                    <button
                      type="button"
                      onClick={sendTrackingUpdate}
                      disabled={sendingTrackingId === selectedOrder.id || !selectedOrder.email}
                      className="h-10 px-4 rounded-xl bg-sky-700 text-white text-xs font-semibold hover:bg-sky-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 shrink-0"
                    >
                      {sendingTrackingId === selectedOrder.id
                        ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        : <Send className="w-3.5 h-3.5" />}
                      {selectedOrder.trackingSentAt ? "Send Again" : "Save & Send"}
                    </button>
                  </div>
                  {!selectedOrder.email && <p className="text-[11px] text-rose-600">No email address is saved for this order.</p>}
                  {selectedOrder.trackingSentAt && selectedOrder.trackingUrl && (
                    <a
                      href={selectedOrder.trackingUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-[11px] text-sky-700 underline underline-offset-2 break-all"
                    >
                      {selectedOrder.trackingUrl}
                    </a>
                  )}
                </div>

                {/* Financial Summary */}
                <div className="pt-3 border-t border-border/30 flex items-center justify-between text-sm">
                  <span className="font-semibold text-foreground/60">Total Order Amount</span>
                  <span className="text-lg font-bold text-primary">
                    ₹{selectedOrder.total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {/* Footer Actions */}
              <div className="px-6 py-4 bg-muted/10 border-t border-border/30 flex items-center justify-between">
                <button
                  onClick={() => {
                    const currentIdx = ALL_STATUSES.findIndex((s) => s.id === (selectedOrder.status || "").toLowerCase());
                    const nextStatus = ALL_STATUSES[(currentIdx + 1) % ALL_STATUSES.length].id;
                    updateOrderStatus(selectedOrder.id, nextStatus);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2 shadow-xs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${updatingId === selectedOrder.id ? "animate-spin" : ""}`} />
                  Advance Status
                </button>

                <button
                  onClick={() => setSelectedOrder(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold border border-border/50 text-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}


