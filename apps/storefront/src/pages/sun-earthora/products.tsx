import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Filter, Plus, Package, Eye, Trash2, X, Leaf, UploadCloud, Users, Star, CheckCircle2, IndianRupee, Tag, Info, ClipboardList, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { saveAdminProduct } from "@/lib/adminProducts";
import { invalidateCatalog } from "@/lib/catalog";
import { useEscapeKey } from "@/hooks/useEscapeKey";

import { productImageFallback } from '@/lib/productImageFallback';

interface ProductImage {
  url: string;
  alt: string;
  is_primary: boolean;
}

interface AdminProduct {
  id: string;
  name: string;
  mrp: number;
  price: number;
  stock: number;
  sold: number;
  status: string;
  tag: string;
  badge: string;
  stockText: string;
  description: string;
  highlights: string[];
  rating: number;
  images: ProductImage[];
  hsn_code?: string;
}


export default function AdminProducts() {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);
  const { toast } = useToast();

  const [form, setForm] = useState({
    name: "", mrp: "", price: "", tag: "", badge: "", stockText: "", stock: "", description: "",
    highlights: [""], rating: "", category: "moringa", hsn_code: "12119029",
  });
  const [images, setImages] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Restock modal state
  const [restockModal, setRestockModal] = useState<{
    open: boolean;
    productId: string;
    productName: string;
    qty: string;
    notes: string;
    waitingCount: number;
    submitting: boolean;
  }>({
    open: false, productId: "", productName: "", qty: "", notes: "",
    waitingCount: 0, submitting: false,
  });

  useEscapeKey(() => setShowForm(false), showForm);
  useEscapeKey(() => setRestockModal((m) => ({ ...m, open: false })), restockModal.open);

  const fetchProducts = async () => {
    try {
      
      const [prodRes, orderItemsRes] = await Promise.all([
        supabase
          .from("products")
          .select("*, inventory(*)")
          .neq("status", "archived")
          .order("created_at", { ascending: false }),
        supabase.from("order_items").select("product_id, quantity"),
      ]);
        
      if (prodRes.error) throw prodRes.error;
      
      const data = (prodRes.data || []) as any[];
      const orderItems = (orderItemsRes.data || []) as any[];

      const soldMap: Record<string, number> = {};
      for (const item of orderItems) {
        if (item.product_id) {
          soldMap[item.product_id] = (soldMap[item.product_id] || 0) + (Number(item.quantity) || 0);
        }
      }

      const mapped = data.map((p: any) => {
        const inv = Array.isArray(p.inventory) ? p.inventory[0] : p.inventory;
        const stockQty = inv?.total_stock ?? 0;
        return {
          id: p.id,
          name: p.name,
          mrp: Number(p.mrp),
          price: Number(p.price),
          stock: stockQty,
          sold: soldMap[p.id] || 0,
          status: p.status,
          tag: p.tag || "",
          badge: p.badge || "",
          stockText: stockQty > 15 ? "In Stock" : stockQty > 0 ? "Low Stock" : "Out of Stock",
          description: p.description || "",
          highlights: p.highlights || [],
          rating: Number(p.rating),
          images: Array.isArray(p.images) ? (p.images as any) : [],
          hsn_code: p.hsn_code || "12119029",
        };
      });
      setProducts(mapped);
    } catch (err: any) {
      console.error(err);
      toast({ title: "Fetch failed", description: err.message || "Failed to load products.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
    
    const channel = supabase
        .channel("inventory-and-order-changes")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "inventory" },
          () => fetchProducts()
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "order_items" },
          () => fetchProducts()
        )
        .subscribe();
        
      return () => {
        supabase.removeChannel(channel);
      };
  }, []);

  const handleDeleteProduct = async (id: string) => {
    try {
      const { error } = await (supabase.from("products") as any)
        .update({ status: "archived" })
        .eq("id", id);
        
      if (error) throw error;
      invalidateCatalog();
      toast({ title: "Product archived", description: "Product soft deleted successfully." });
      fetchProducts();
    } catch (err: any) {
      console.error("Soft delete failed:", err);
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    }
  };

  const openRestockModal = async (product: AdminProduct) => {
    // Fetch waiting customer count
    let waitingCount = 0;
    try {
      const { count } = await (supabase
        .from("customer_restock_requests") as any)
        .select("*", { count: "exact", head: true })
        .eq("product_id", product.id)
        .eq("status", "waiting");
      waitingCount = count ?? 0;
    } catch (_) {
      // silently ignore — count badge is cosmetic
    }
    setRestockModal({
      open: true,
      productId: product.id,
      productName: product.name,
      qty: "",
      notes: "",
      waitingCount,
      submitting: false,
    });
  };

  const handleRestockSubmit = async () => {
    const qty = parseInt(restockModal.qty);
    if (isNaN(qty) || qty <= 0) {
      toast({ title: "Invalid quantity", description: "Please enter a positive number.", variant: "destructive" });
      return;
    }
    setRestockModal(m => ({ ...m, submitting: true }));
    try {
      const { error } = await (supabase.rpc as any)("restock_product", {
        p_product_id: restockModal.productId,
        p_quantity: qty,
        p_notes: restockModal.notes || "Restocked via admin portal",
      });
      if (error) throw error;
      invalidateCatalog();
      toast({ title: "Product restocked", description: `Added ${qty} units to inventory.` });
      setRestockModal(m => ({ ...m, open: false }));
      fetchProducts();
    } catch (err: any) {
      toast({ title: "Restock failed", description: err.message, variant: "destructive" });
      setRestockModal(m => ({ ...m, submitting: false }));
    }
  };

  const openForm = () => {
    setEditId(null);
    setPendingProductId(null);
    setForm({ name: "", mrp: "", price: "", tag: "", badge: "", stockText: "In Stock", stock: "", description: "", highlights: [""], rating: "4.5", category: "moringa", hsn_code: "12119029" });
    setImages([]);
    setSelectedFiles([]);
    setShowForm(true);
  };

  const openEditForm = (p: AdminProduct) => {
    setEditId(p.id);
    setPendingProductId(null);
    setForm({
      name: p.name,
      mrp: String(p.mrp),
      price: String(p.price),
      tag: p.tag || "",
      badge: p.badge || "",
      stockText: p.stockText || "In Stock",
      stock: String(p.stock),
      description: p.description || "",
      highlights: p.highlights?.length ? p.highlights : [""],
      rating: String(p.rating || 4.5),
      category: "moringa",
      hsn_code: p.hsn_code || "12119029",
    });
    // Load existing product images as preview urls
    const existingImgUrls = (p.images || []).map((img: any) => img.url || img);
    setImages(existingImgUrls);
    setSelectedFiles([]);
    setShowForm(true);
  };

  const addHighlight = () => setForm((f) => ({ ...f, highlights: [...f.highlights, ""] }));
  const removeHighlight = (i: number) => setForm((f) => ({ ...f, highlights: f.highlights.filter((_, idx) => idx !== i) }));
  const setHighlight = (i: number, v: string) => setForm((f) => {
    const h = [...f.highlights];
    h[i] = v;
    return { ...f, highlights: h };
  });

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.mrp || !form.price) {
      toast({ title: "Missing fields", description: "Name, MRP, and Price are required." });
      return;
    }
    setUploading(true);
    try {
      const baseSlug = form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "product";
      let slug = baseSlug;
      if (!editId && !pendingProductId) {
        const { data: existing, error } = await supabase.from("products").select("slug").eq("slug", baseSlug).maybeSingle();
        if (error) throw error;
        if (existing) slug = `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`;
      }
      await saveAdminProduct({
        id: editId || pendingProductId,
        publishNew: !editId,
        slug,
        fields: {
          name: form.name.trim(), mrp: Number(form.mrp), price: Number(form.price),
          tag: form.tag, badge: form.badge, description: form.description,
          highlights: form.highlights.filter(h => h.trim()), rating: Number(form.rating) || 4.5,
          category: form.category || "moringa", hsn_code: form.hsn_code,
        },
        stock: form.stock.trim() ? Number(form.stock) : 0,
        files: selectedFiles, images, onCreated: setPendingProductId,
      });
      toast({ title: editId ? "Product updated" : "Product published", description: editId ? `${form.name} is saved. The catalogue refreshes automatically.` : `${form.name} is now available on the website.` });
      setImages([]);
      setSelectedFiles([]);
      setShowForm(false);
      setEditId(null);
      setPendingProductId(null);
      await fetchProducts();
    } catch (err: any) {
      toast({ title: "Product not saved", description: `${err.message || "Please try again."} Your details are kept here so you can retry.`, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const discount = form.mrp && form.price ? Math.round((1 - parseFloat(form.price) / parseFloat(form.mrp)) * 100) : 0;

  return (
    <>
      <motion.div
        key="products"
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
                placeholder="Search products..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-11 pl-10 pr-4 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all w-60 placeholder:text-foreground/30"
              />
            </div>
            <button className="h-11 px-3.5 rounded-xl border border-border/40 bg-white text-foreground/50 hover:text-foreground hover:border-border/60 hover:bg-muted/10 transition-all">
              <Filter className="w-4 h-4" strokeWidth={1.5} />
            </button>
            <span className="text-xs text-foreground/30 ml-2">
              {searchQuery.trim()
                ? `${products.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.tag?.toLowerCase().includes(searchQuery.toLowerCase())).length} of ${products.length} products`
                : `${products.length} products total`}
            </span>
          </div>
          <Button className="gap-1.5 h-11 px-5 shadow-md" onClick={openForm}>
            <Plus className="w-4 h-4" strokeWidth={2} />
            Add Product
          </Button>
        </div>

        <div className="w-full">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-foreground/40">
              Loading products...
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-20 bg-white border border-border/40 rounded-2xl text-foreground/40 font-medium">
              No products yet. Add your first product.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {products
                .filter(p => !searchQuery.trim() ||
                  p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  (p.tag || "").toLowerCase().includes(searchQuery.toLowerCase())
                )
                .map((p, i) => (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: i * 0.05 }}
                  className="bg-white rounded-2xl border border-border/40 overflow-hidden shadow-sm hover:shadow-[0_8px_30px_rgb(0,0,0,0.03)] hover:border-primary/20 transition-all duration-300 flex flex-col group/prod"
                >
                  <div className="relative aspect-square bg-[#fafaf8] flex items-center justify-center border-b border-border/20 group-hover/prod:bg-primary/[0.02] transition-colors duration-300 overflow-hidden">
                    {(() => {
                      const rawUrl = p.images?.find((img) => img.is_primary)?.url || p.images?.[0]?.url;
                      const hasValidUrl = rawUrl && !rawUrl.includes("undefined") && rawUrl.startsWith("http");
                      
                      const fallbackSrc = productImageFallback(p.name).main;
                      const displaySrc = hasValidUrl ? rawUrl : fallbackSrc;

                      return (
                        <img 
                          src={displaySrc} 
                          alt={p.name} 
                          className="object-cover w-full h-full transition-transform duration-500 group-hover/prod:scale-105" 
                          onError={(e) => {
                            if (e.currentTarget.src !== fallbackSrc) e.currentTarget.src = fallbackSrc;
                          }}
                        />
                      );
                    })()}
                    <span className="absolute top-4 right-4 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-green-50/90 text-green-700 border border-green-200 backdrop-blur-sm">Active</span>
                  </div>
                  <div className="p-5 flex flex-col flex-1">
                    <h3 className="text-sm font-semibold text-foreground leading-snug truncate mb-1">{p.name}</h3>
                    <p className="text-[11px] text-foreground/40 mb-4">Stock ID: {p.id.toUpperCase()}</p>
                    <div className="space-y-3 mt-auto">
                      {p.badge && <span className="inline-block px-2 py-0.5 text-[10px] font-bold bg-primary/10 text-primary rounded">{p.badge}</span>}
                      <div className="flex justify-between items-baseline">
                        <span className="text-xs text-foreground/45 font-medium">Price</span>
                        <div className="text-right">
                          <span className="text-base font-bold text-foreground">{p.price}</span>
                          <span className="text-[10px] text-foreground/30 line-through ml-1.5">{p.mrp}</span>
                          <span className="text-[10px] text-accent font-bold ml-1">{Math.round((1 - p.price / p.mrp) * 100)}% off</span>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs font-semibold">
                          <span className="text-foreground/40">Stock ({p.stock} units)</span>
                          <span className={p.stock < 20 ? "text-red-500 font-bold" : p.stock < 30 ? "text-amber-500 font-bold" : "text-green-500 font-bold"}>
                            {p.stock < 20 ? "Low Stock" : p.stock < 30 ? "Medium" : "In Stock"}
                          </span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-border/40 overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-500 ${p.stock < 20 ? "bg-red-500" : p.stock < 30 ? "bg-amber-500" : "bg-green-500"}`} style={{ width: `${Math.min(100, (p.stock / 50) * 100)}%` }} />
                        </div>
                      </div>
                      <div className="pt-3 border-t border-border/10 flex items-center justify-between">
                        <span className="text-xs text-foreground/40 font-semibold">Sold: <span className="text-foreground font-bold ml-0.5">{p.sold}</span></span>
                        <div className="flex gap-1">
                          <button onClick={() => openRestockModal(p)} className="p-2 rounded-lg bg-[#fafaf8] text-foreground/40 hover:text-primary hover:bg-primary/5 transition-colors" title="Restock product">
                            <Plus className="w-4 h-4" strokeWidth={1.5} />
                          </button>
                          <button onClick={() => openEditForm(p)} className="p-2 rounded-lg bg-[#fafaf8] text-foreground/40 hover:text-primary hover:bg-primary/5 transition-colors" title="Edit product"><Eye className="w-4 h-4" strokeWidth={1.5} /></button>
                          <button onClick={() => handleDeleteProduct(p.id)} className="p-2 rounded-lg bg-[#fafaf8] text-foreground/40 hover:text-red-500 hover:bg-red-50 transition-colors" title="Delete product"><Trash2 className="w-4 h-4" strokeWidth={1.5} /></button>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {showForm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={() => setShowForm(false)} />
            <motion.div
              initial={{ opacity: 0, y: "100%" }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: "100%" }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-0 md:inset-x-8 md:inset-y-6 lg:inset-x-16 lg:inset-y-8 max-w-6xl mx-auto z-50 bg-[#FAF9F5] md:rounded-3xl overflow-hidden flex flex-col shadow-2xl border border-black/10"
            >
              {/* ── Modal Header ────────────────────────────────────── */}
              <header className="flex items-center justify-between px-6 md:px-8 h-[68px] border-b border-black/8 shrink-0 bg-white">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#0E1F13] flex items-center justify-center">
                    <Leaf className="w-4 h-4 text-white" strokeWidth={1.75} />
                  </div>
                  <div>
                    <h2 className="font-dm text-lg text-black leading-tight tracking-[-0.02em]">
                      {editId ? "Edit product" : "Add new product"}
                    </h2>
                    <p className="text-[11px] font-inter text-black/50 leading-tight">
                      Everything you fill in shows up on the product detail page live.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => { setShowForm(false); setEditId(null); }}
                  className="p-2 rounded-full hover:bg-black/5 transition-colors"
                  aria-label="Close"
                >
                  <X className="w-5 h-5 text-black/60" />
                </button>
              </header>

              <div className="flex-1 overflow-hidden">
                <div className="grid grid-cols-1 lg:grid-cols-12 h-full">

                  {/* ── Left: Live Preview + Image Upload ─────────────── */}
                  <aside className="lg:col-span-5 border-b lg:border-b-0 lg:border-r border-black/8 bg-[#FAF9F5] overflow-y-auto">
                    <div className="p-6 md:p-8 lg:p-10">
                      <div className="flex items-center gap-2 mb-5">
                        <ImageIcon className="w-3.5 h-3.5 text-black/40" />
                        <span className="text-[10px] font-inter font-semibold tracking-[0.2em] uppercase text-black/45">
                          Gallery &amp; live preview
                        </span>
                      </div>

                      {/* Primary image well — mirrors the PDP main image */}
                      <div
                        onClick={() => document.getElementById("multi-img-input")?.click()}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.currentTarget.classList.add("border-[#0E1F13]", "bg-[#0E1F13]/[0.03]");
                        }}
                        onDragLeave={(e) => {
                          e.currentTarget.classList.remove("border-[#0E1F13]", "bg-[#0E1F13]/[0.03]");
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.currentTarget.classList.remove("border-[#0E1F13]", "bg-[#0E1F13]/[0.03]");
                          const files = e.dataTransfer.files;
                          if (files) {
                            const validFiles = Array.from(files).filter(f => f.size <= 5 * 1024 * 1024);
                            if (validFiles.length < files.length) {
                              toast({ title: "Files skipped", description: "Some files exceeded the 5MB size limit.", variant: "destructive" });
                            }
                            const newImages = validFiles.map((f) => URL.createObjectURL(f));
                            setImages(newImages);
                            setSelectedFiles(validFiles);
                          }
                        }}
                        className="relative aspect-square w-full rounded-3xl border-2 border-dashed border-black/15 bg-[#F3F1EA] cursor-pointer hover:border-[#0E1F13]/40 transition-all group overflow-hidden"
                      >
                        {/* PDP-style badge chip */}
                        {form.badge && (
                          <span className="absolute top-4 left-4 z-10 px-3 py-1.5 rounded-full bg-[#0E1F13] text-white text-[10px] font-inter font-semibold tracking-[0.2em] uppercase shadow-sm pointer-events-none">
                            {form.badge}
                          </span>
                        )}
                        {discount > 0 && (
                          <span className="absolute top-4 right-4 z-10 px-3 py-1.5 rounded-full bg-white text-[#0E1F13] border border-black/10 text-xs font-inter font-bold tracking-wide shadow-sm pointer-events-none">
                            Save {discount}%
                          </span>
                        )}

                        {images.length > 0 ? (
                          <>
                            <img src={images[0]} alt="Primary" className="w-full h-full object-cover" />
                            {uploading && (
                              <div className="absolute inset-0 bg-black/45 backdrop-blur-sm flex items-center justify-center text-white text-xs font-semibold gap-2">
                                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                Uploading to storage…
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6">
                            <div className="w-14 h-14 rounded-2xl bg-white border border-black/10 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                              <UploadCloud className="w-6 h-6 text-[#0E1F13]/60" />
                            </div>
                            <p className="text-sm font-inter font-medium text-black/70">Drop images here</p>
                            <p className="text-[11px] font-inter text-black/40 mt-1">or click to browse — up to 5MB each</p>
                          </div>
                        )}

                        <input
                          id="multi-img-input"
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            const files = e.target.files;
                            if (files) {
                              const validFiles = Array.from(files).filter(f => f.size <= 5 * 1024 * 1024);
                              if (validFiles.length < files.length) {
                                toast({ title: "Files skipped", description: "Some files exceeded the 5MB size limit.", variant: "destructive" });
                              }
                              const newImages = validFiles.map((f) => URL.createObjectURL(f));
                              setImages(newImages);
                              setSelectedFiles(validFiles);
                            }
                          }}
                        />
                      </div>

                      {/* Thumbnail rail (secondary images) */}
                      {images.length > 1 && (
                        <div className="grid grid-cols-5 gap-2 mt-3">
                          {images.slice(1).map((src, i) => (
                            <div key={i} className="aspect-square rounded-xl border border-black/10 bg-white p-1.5 relative">
                              <img src={src} alt="" className="w-full h-full object-cover rounded-md" />
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setImages((prev) => prev.filter((_, idx) => idx !== i + 1));
                                  setSelectedFiles((prev) => prev.filter((_, idx) => idx !== i + 1));
                                }}
                                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-500 text-white flex items-center justify-center opacity-80 hover:opacity-100 transition-opacity shadow-sm"
                              >
                                <X className="w-3 h-3" strokeWidth={2} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      {images.length > 0 && (
                        <button
                          type="button"
                          onClick={() => { setImages([]); setSelectedFiles([]); }}
                          className="w-full text-[11px] font-inter text-black/40 hover:text-rose-500 transition-colors py-2 mt-2"
                        >
                          Clear all images ({images.length})
                        </button>
                      )}

                      {/* Live PDP preview card (matches product-detail.tsx layout) */}
                      <div className="mt-8 rounded-3xl bg-white border border-black/8 p-6">
                        <span className="block text-[10px] font-inter font-semibold tracking-[0.2em] uppercase text-black/45 mb-3">
                          Detail page preview
                        </span>
                        {form.tag && (
                          <p className="font-inter text-[10px] font-semibold tracking-[0.2em] uppercase text-emerald-900 mb-1.5">
                            {form.tag}
                          </p>
                        )}
                        <h3 className="font-dm text-2xl font-normal tracking-[-0.02em] text-black leading-tight">
                          {form.name || <span className="text-black/25">Product name will appear here</span>}
                        </h3>

                        {/* Rating row */}
                        <div className="flex items-center gap-2 mt-3">
                          <div className="flex items-center gap-0.5">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <Star
                                key={i}
                                className={`w-3.5 h-3.5 ${
                                  i < Math.floor(parseFloat(form.rating || "0"))
                                    ? "fill-amber-500 text-amber-500"
                                    : "fill-amber-500/20 text-amber-500/30"
                                }`}
                              />
                            ))}
                          </div>
                          <span className="text-xs font-inter font-semibold text-black">
                            {form.rating || "4.9"}
                          </span>
                        </div>

                        {/* Price row */}
                        <div className="mt-4 flex items-baseline gap-2">
                          <span className="font-dm text-2xl font-normal text-[#0E1F13] tracking-tight">
                            {form.price ? `₹${form.price}` : <span className="text-black/25">₹—</span>}
                          </span>
                          {form.mrp && parseFloat(form.mrp) > parseFloat(form.price || "0") && (
                            <span className="font-inter text-sm line-through text-black/40">₹{form.mrp}</span>
                          )}
                          {discount > 0 && (
                            <span className="text-[10px] font-inter font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                              -{discount}%
                            </span>
                          )}
                        </div>

                        {form.description && (
                          <p className="mt-4 font-inter text-xs text-black/70 leading-relaxed line-clamp-3">
                            {form.description}
                          </p>
                        )}

                        {/* Highlights preview */}
                        {form.highlights.filter((h) => h.trim()).length > 0 && (
                          <ul className="mt-4 space-y-1.5">
                            {form.highlights.filter((h) => h.trim()).slice(0, 4).map((h, i) => (
                              <li key={i} className="flex items-start gap-2 text-[11px] font-inter text-black/75">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0 mt-0.5" />
                                <span>{h}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </aside>

                  {/* ── Right: Form Sections ───────────────────────────── */}
                  <div className="lg:col-span-7 overflow-y-auto">
                    <div className="p-6 md:p-8 lg:p-10 pb-32 space-y-6 max-w-2xl mx-auto">

                      {/* SECTION 1 — Identity */}
                      <section className="bg-white rounded-2xl border border-black/8 p-6">
                        <div className="flex items-center gap-2 mb-5">
                          <Tag className="w-3.5 h-3.5 text-black/50" />
                          <h3 className="font-inter text-xs font-semibold tracking-[0.2em] uppercase text-black/60">
                            Identity
                          </h3>
                        </div>

                        <div className="space-y-4">
                          <div>
                            <label className="text-xs font-inter font-semibold text-black/70 mb-1.5 block">
                              Product name <span className="text-rose-500">*</span>
                            </label>
                            <input
                              type="text"
                              value={form.name}
                              onChange={(e) => setForm({ ...form, name: e.target.value })}
                              placeholder="e.g. Morilife+ Moringa Leaf Tablets"
                              className="w-full h-11 px-4 text-sm bg-[#FAF9F5] border border-black/10 rounded-xl outline-none focus:border-[#0E1F13] focus:bg-white transition-all placeholder:text-black/30"
                            />
                            <p className="text-[10px] font-inter text-black/40 mt-1.5">
                              The big serif title on the PDP.
                            </p>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className="text-xs font-inter font-semibold text-black/70 mb-1.5 block">
                                Tag / subtitle
                              </label>
                              <input
                                type="text"
                                value={form.tag}
                                onChange={(e) => setForm({ ...form, tag: e.target.value })}
                                placeholder="500mg · 90 Capsules"
                                className="w-full h-11 px-4 text-sm bg-[#FAF9F5] border border-black/10 rounded-xl outline-none focus:border-[#0E1F13] focus:bg-white transition-all placeholder:text-black/30"
                              />
                              <p className="text-[10px] font-inter text-black/40 mt-1.5">
                                Small overline shown above the title.
                              </p>
                            </div>
                            <div>
                              <label className="text-xs font-inter font-semibold text-black/70 mb-1.5 block">
                                Badge
                              </label>
                              <input
                                type="text"
                                value={form.badge}
                                onChange={(e) => setForm({ ...form, badge: e.target.value })}
                                placeholder="New, Best Seller…"
                                className="w-full h-11 px-4 text-sm bg-[#FAF9F5] border border-black/10 rounded-xl outline-none focus:border-[#0E1F13] focus:bg-white transition-all placeholder:text-black/30"
                              />
                              <p className="text-[10px] font-inter text-black/40 mt-1.5">
                                Dark pill chip on the hero image.
                              </p>
                            </div>
                          </div>
                        </div>
                      </section>

                      {/* SECTION 2 — Pricing */}
                      <section className="bg-white rounded-2xl border border-black/8 p-6">
                        <div className="flex items-center gap-2 mb-5">
                          <IndianRupee className="w-3.5 h-3.5 text-black/50" />
                          <h3 className="font-inter text-xs font-semibold tracking-[0.2em] uppercase text-black/60">
                            Pricing
                          </h3>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-xs font-inter font-semibold text-black/70 mb-1.5 block">
                              MRP (₹) <span className="text-rose-500">*</span>
                            </label>
                            <input
                              type="number"
                              value={form.mrp}
                              onChange={(e) => setForm({ ...form, mrp: e.target.value })}
                              placeholder="999"
                              className="w-full h-11 px-4 text-sm bg-[#FAF9F5] border border-black/10 rounded-xl outline-none focus:border-[#0E1F13] focus:bg-white transition-all placeholder:text-black/30 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-inter font-semibold text-black/70 mb-1.5 block">
                              Selling price (₹) <span className="text-rose-500">*</span>
                            </label>
                            <input
                              type="number"
                              value={form.price}
                              onChange={(e) => setForm({ ...form, price: e.target.value })}
                              placeholder="699"
                              className="w-full h-11 px-4 text-sm bg-[#FAF9F5] border border-black/10 rounded-xl outline-none focus:border-[#0E1F13] focus:bg-white transition-all placeholder:text-black/30 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                          </div>
                        </div>

                        {form.mrp && form.price && discount > 0 && (
                          <div className="mt-4 p-3 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                              <span className="text-xs font-inter font-semibold text-emerald-900">
                                {discount}% off
                              </span>
                            </div>
                            <span className="text-xs font-inter text-emerald-800">
                              Customer saves ₹{Math.max(0, parseFloat(form.mrp) - parseFloat(form.price)).toFixed(0)}
                            </span>
                          </div>
                        )}
                      </section>

                      {/* SECTION 3 — Story (matches PDP description + highlights) */}
                      <section className="bg-white rounded-2xl border border-black/8 p-6">
                        <div className="flex items-center gap-2 mb-5">
                          <ClipboardList className="w-3.5 h-3.5 text-black/50" />
                          <h3 className="font-inter text-xs font-semibold tracking-[0.2em] uppercase text-black/60">
                            Story on the page
                          </h3>
                        </div>

                        <div className="space-y-5">
                          <div>
                            <label className="text-xs font-inter font-semibold text-black/70 mb-1.5 block">
                              Description
                            </label>
                            <textarea
                              value={form.description}
                              onChange={(e) => setForm({ ...form, description: e.target.value })}
                              rows={4}
                              placeholder="A short paragraph the buyer sees under the price. Keep it warm and specific."
                              className="w-full px-4 py-3 text-sm bg-[#FAF9F5] border border-black/10 rounded-xl outline-none focus:border-[#0E1F13] focus:bg-white transition-all resize-none placeholder:text-black/30 leading-relaxed"
                            />
                          </div>

                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <label className="text-xs font-inter font-semibold text-black/70">
                                Key highlights
                              </label>
                              <button
                                type="button"
                                onClick={addHighlight}
                                className="inline-flex items-center gap-1 text-xs font-inter font-semibold text-[#0E1F13] hover:text-[#2E5B32] transition-colors"
                              >
                                <Plus className="w-3 h-3" strokeWidth={2.5} /> Add row
                              </button>
                            </div>
                            <div className="space-y-2">
                              {form.highlights.map((h, i) => (
                                <div key={i} className="flex items-center gap-2 group">
                                  <span className="shrink-0 w-6 h-6 rounded-md bg-emerald-50 text-emerald-700 flex items-center justify-center">
                                    <CheckCircle2 className="w-3 h-3" />
                                  </span>
                                  <input
                                    type="text"
                                    value={h}
                                    onChange={(e) => setHighlight(i, e.target.value)}
                                    placeholder={`Highlight ${i + 1}`}
                                    className="flex-1 h-11 px-4 text-sm bg-[#FAF9F5] border border-black/10 rounded-xl outline-none focus:border-[#0E1F13] focus:bg-white transition-all placeholder:text-black/30"
                                  />
                                  {form.highlights.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => removeHighlight(i)}
                                      className="p-2 rounded-lg text-black/30 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                                      aria-label="Remove highlight"
                                    >
                                      <X className="w-4 h-4" strokeWidth={1.75} />
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                            <p className="text-[10px] font-inter text-black/40 mt-2">
                              Shown as a two-column checkmark list under the description on the PDP.
                            </p>
                          </div>
                        </div>
                      </section>

                      {/* SECTION 4 — Rating & Reviews */}
                      <section className="bg-white rounded-2xl border border-black/8 p-6">
                        <div className="flex items-center gap-2 mb-5">
                          <Star className="w-3.5 h-3.5 text-black/50" />
                          <h3 className="font-inter text-xs font-semibold tracking-[0.2em] uppercase text-black/60">
                            Rating
                          </h3>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2 h-11 bg-[#FAF9F5] border border-black/10 rounded-xl px-4 flex-1 focus-within:border-[#0E1F13] focus-within:bg-white transition-all">
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              max="5"
                              value={form.rating}
                              onChange={(e) => setForm({ ...form, rating: e.target.value })}
                              placeholder="4.5"
                              className="w-14 bg-transparent text-sm outline-none placeholder:text-black/30 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                            <span className="text-[10px] font-inter font-semibold text-black/40 uppercase tracking-wider">
                              / 5 stars
                            </span>
                            <div className="ml-auto flex items-center gap-0.5">
                              {Array.from({ length: 5 }).map((_, i) => (
                                <Star
                                  key={i}
                                  className={`w-3.5 h-3.5 ${
                                    i < Math.floor(parseFloat(form.rating || "0"))
                                      ? "fill-amber-500 text-amber-500"
                                      : "fill-amber-500/20 text-amber-500/30"
                                  }`}
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                        <p className="text-[10px] font-inter text-black/40 mt-2">
                          Live reviews eventually override this; use it as a seed value.
                        </p>
                      </section>

                      {/* SECTION 5 — Inventory */}
                      <section className="bg-white rounded-2xl border border-black/8 p-6">
                        <div className="flex items-center gap-2 mb-5">
                          <Package className="w-3.5 h-3.5 text-black/50" />
                          <h3 className="font-inter text-xs font-semibold tracking-[0.2em] uppercase text-black/60">
                            Inventory
                          </h3>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="text-xs font-inter font-semibold text-black/70 mb-1.5 block">
                              Stock quantity
                            </label>
                            <input
                              type="number"
                              value={form.stock}
                              onChange={(e) => setForm({ ...form, stock: e.target.value })}
                              placeholder="50"
                              className="w-full h-11 px-4 text-sm bg-[#FAF9F5] border border-black/10 rounded-xl outline-none focus:border-[#0E1F13] focus:bg-white transition-all placeholder:text-black/30 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-inter font-semibold text-black/70 mb-1.5 block">
                              Displayed status
                            </label>
                            <div className="flex gap-1 bg-[#FAF9F5] border border-black/10 rounded-xl p-1 h-11">
                              {[
                                { value: "In Stock",     label: "In stock",     color: "text-emerald-800" },
                                { value: "Low Stock",    label: "Low",          color: "text-amber-800" },
                                { value: "Out of Stock", label: "Out",          color: "text-rose-700" },
                              ].map((opt) => (
                                <button
                                  key={opt.value}
                                  type="button"
                                  onClick={() => setForm({ ...form, stockText: opt.value })}
                                  className={`flex-1 rounded-lg text-[11px] font-inter font-semibold transition-all ${
                                    form.stockText === opt.value
                                      ? "bg-[#0E1F13] text-white shadow-sm"
                                      : `${opt.color} hover:bg-white`
                                  }`}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </section>

                      {/* SECTION 6 — Ops & Taxonomy */}
                      <section className="bg-white rounded-2xl border border-black/8 p-6">
                        <div className="flex items-center gap-2 mb-5">
                          <Info className="w-3.5 h-3.5 text-black/50" />
                          <h3 className="font-inter text-xs font-semibold tracking-[0.2em] uppercase text-black/60">
                            Operations
                          </h3>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="text-xs font-inter font-semibold text-black/70 mb-1.5 block">
                              Category <span className="text-rose-500">*</span>
                            </label>
                            <input
                              type="text"
                              value={form.category}
                              onChange={(e) => setForm({ ...form, category: e.target.value })}
                              placeholder="moringa, amla…"
                              className="w-full h-11 px-4 text-sm bg-[#FAF9F5] border border-black/10 rounded-xl outline-none focus:border-[#0E1F13] focus:bg-white transition-all placeholder:text-black/30"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-inter font-semibold text-black/70 mb-1.5 block">
                              HSN code <span className="text-rose-500">*</span>
                            </label>
                            <input
                              type="text"
                              required
                              value={form.hsn_code}
                              onChange={(e) => setForm({ ...form, hsn_code: e.target.value })}
                              placeholder="12119029"
                              className="w-full h-11 px-4 text-sm bg-[#FAF9F5] border border-black/10 rounded-xl outline-none focus:border-[#0E1F13] focus:bg-white transition-all placeholder:text-black/30"
                            />
                          </div>
                        </div>
                        <p className="text-[10px] font-inter text-black/40 mt-3">
                          HSN drives GST on invoices — 12119029 is dried medicinal plant matter.
                        </p>
                      </section>

                    </div>
                  </div>

                </div>
              </div>

              {/* ── Sticky footer action bar ────────────────────────── */}
              <footer className="shrink-0 h-[68px] border-t border-black/8 bg-white px-6 md:px-8 flex items-center justify-between gap-4">
                <p className="text-[11px] font-inter text-black/45 hidden sm:block">
                  Preview updates as you type. Nothing is saved until you press{" "}
                  <span className="font-semibold text-black/70">{editId ? "Save changes" : "Create product"}</span>.
                </p>
                <div className="flex items-center gap-3 ml-auto">
                  <Button
                    variant="outline"
                    onClick={() => { setShowForm(false); setEditId(null); }}
                    className="h-10 px-5 border-black/15 text-black/70 hover:bg-black/5"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSubmit}
                    className="h-10 px-6 gap-2 bg-[#0E1F13] hover:bg-[#0E1F13]/90 text-white shadow-md"
                  >
                    <Leaf className="w-4 h-4" strokeWidth={1.75} />
                    {editId ? "Save changes" : "Create product"}
                  </Button>
                </div>
              </footer>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Restock Modal ────────────────────────────────────────────── */}
      <AnimatePresence>
        {restockModal.open && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
              onClick={() => setRestockModal(m => ({ ...m, open: false }))}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
            >
              <div className="bg-card border border-border/50 rounded-2xl shadow-2xl w-full max-w-md p-6 pointer-events-auto">
                {/* Header */}
                <div className="flex items-start justify-between mb-5">
                  <div>
                    <h2 className="text-base font-semibold text-foreground mb-1">Restock Product</h2>
                    <p className="text-xs text-foreground/50">{restockModal.productName}</p>
                  </div>
                  <button onClick={() => setRestockModal(m => ({ ...m, open: false }))} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                    <X className="w-4 h-4 text-foreground/50" />
                  </button>
                </div>

                {/* Waiting customers badge */}
                {restockModal.waitingCount > 0 && (
                  <div className="flex items-center gap-2 p-3 mb-5 rounded-xl bg-primary/8 border border-primary/20">
                    <Users className="w-4 h-4 text-primary shrink-0" />
                    <p className="text-xs text-primary font-medium">
                      <span className="font-bold">{restockModal.waitingCount}</span> customer{restockModal.waitingCount !== 1 ? "s" : ""} waiting, 
                      they'll be automatically SMS-notified when you restock.
                    </p>
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-foreground/70 mb-1.5">
                      Quantity to Add <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={restockModal.qty}
                      onChange={e => setRestockModal(m => ({ ...m, qty: e.target.value }))}
                      placeholder="e.g. 100"
                      className="w-full px-3 py-2.5 text-sm bg-background border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground/70 mb-1.5">
                      Notes <span className="text-foreground/30">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={restockModal.notes}
                      onChange={e => setRestockModal(m => ({ ...m, notes: e.target.value }))}
                      placeholder="e.g. New batch from supplier"
                      className="w-full px-3 py-2.5 text-sm bg-background border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                  </div>

                  <div className="flex gap-3 pt-1">
                    <Button variant="outline" className="flex-1 h-11" onClick={() => setRestockModal(m => ({ ...m, open: false }))}>
                      Cancel
                    </Button>
                    <Button className="flex-1 h-11 gap-2" onClick={handleRestockSubmit} disabled={restockModal.submitting}>
                      <Plus className="w-4 h-4" strokeWidth={1.5} />
                      {restockModal.submitting ? "Restocking..." : "Confirm Restock"}
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
