import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ShoppingBag, Loader2, Zap, CheckCircle2, Star, ArrowUpRight } from "lucide-react";
import { useCart } from "@/contexts/cart-context";
import { useCheckout } from "@/hooks/useCheckout";
import { useToast } from "@/hooks/use-toast";
import { publicProductsQuery } from "@/lib/catalogQuery";
import type { Product } from "@/types";

export function HomeProducts() {
  const { data: products = [], isLoading } = useQuery<Product[]>({
    ...publicProductsQuery,
    refetchOnMount: "always",
  });

  const [, setLocation] = useLocation();

  useEffect(() => {
    // If ?open=<productId> is present, navigate directly to that product's dedicated page
    const params = new URLSearchParams(window.location.search);
    const openId = params.get("open");
    if (openId) {
      setLocation(`/product/${openId}`);
    }
  }, [setLocation]);

  const handleCardClick = (productId: string) => {
    setLocation(`/product/${productId}`);
  };

  return (
    <section id="products" className="bg-[#FEFDF9] py-24 lg:py-32 relative overflow-hidden scroll-mt-20">
      <div className="container mx-auto max-w-[1400px] px-6 sm:px-10">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-14 lg:mb-16">
          <div className="flex flex-col md:items-start items-center text-center md:text-left">
            <span className="inline-block px-4 py-1.5 rounded-full border border-black/15 bg-[#FAF9F5] text-[10px] font-inter font-semibold tracking-[0.25em] uppercase text-black/60 mb-6">
              OUR PRODUCTS
            </span>
            <motion.h2
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="font-dm font-normal text-[42px] leading-[1.02] sm:text-[56px] sm:leading-[1.02] lg:text-[68px] lg:leading-[0.98] tracking-[-0.04em] text-black max-w-[820px]"
            >
              Choose your <em className="not-italic text-black/45">daily green.</em>
            </motion.h2>
          </div>
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 lg:gap-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-3xl aspect-[3/4] bg-[#F3F1EA] animate-pulse" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-16 text-black/50 font-inter text-sm">
            No products live right now. Check back soon.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 lg:gap-6">
            {products.map((p, i) => (
              <ProductCard
                key={p.id}
                product={p}
                delay={i * 0.08}
                onCardClick={handleCardClick}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ProductCard({
  product,
  delay,
  onCardClick,
}: {
  product: Product;
  delay: number;
  onCardClick: (id: string) => void;
}) {
  const { addToCart } = useCart();
  const { runCheckout, isPaying } = useCheckout();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [justAdded, setJustAdded] = useState(false);
  const [buyingThis, setBuyingThis] = useState(false);

  const cartItem = {
    id: product.id,
    name: product.name,
    price: product.price,
    image: product.imageMain,
  };

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    addToCart(cartItem);
    setJustAdded(true);
    toast({ title: "Added to cart", description: `${product.name} added to your cart.` });
    setTimeout(() => setJustAdded(false), 1600);
  };

  const handleBuyNow = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPaying || buyingThis) return;
    setBuyingThis(true);
    const result = await runCheckout([{ ...cartItem, quantity: 1 }]);
    setBuyingThis(false);
    if (result) setLocation("/cart");
  };

  const savings = product.mrp > product.price ? product.mrp - product.price : 0;
  const savingsPct = product.mrp > 0 ? Math.round((savings / product.mrp) * 100) : 0;
  const showPct = savings > 0 && savingsPct > 0 && savingsPct <= 70;
  const showFlatSavings = savings > 0 && !showPct;

  return (
    <motion.article
      id={`product-${product.id}`}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
      onClick={() => onCardClick(product.id)}
      className="group relative bg-[#FEFDF9] rounded-3xl border border-black/8 flex flex-col overflow-hidden transition-all duration-300 hover:shadow-[0_20px_60px_-20px_rgba(14,31,19,0.18)] cursor-pointer scroll-mt-24"
    >
      {/* Image well */}
      <div className="relative aspect-square w-full overflow-hidden bg-[#F3F1EA]">
        {/* Top-left badge stack */}
        <div className="absolute top-3.5 left-3.5 z-10 flex flex-col gap-1.5 items-start">
          {product.badge && (
            <span className="px-2.5 py-1 rounded-full bg-[#0E1F13] text-white text-[9px] font-inter font-semibold tracking-[0.2em] uppercase">
              {product.badge}
            </span>
          )}
          {showPct && (
            <span className="px-2.5 py-1 rounded-full bg-white text-[#0E1F13] border border-black/10 text-[10px] font-inter font-bold tracking-wide">
              Save {savingsPct}%
            </span>
          )}
          {showFlatSavings && (
            <span className="px-2.5 py-1 rounded-full bg-white text-[#0E1F13] border border-black/10 text-[10px] font-inter font-bold tracking-wide">
              Save ₹{Math.round(savings)}
            </span>
          )}
        </div>

        {/* Show a rating only when it comes from actual customer reviews. */}
        {product.reviewCount > 0 && (
          <div className="absolute top-3.5 right-3.5 z-10 flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-inter font-medium text-black/70 bg-white/85 backdrop-blur-sm px-2 py-1 rounded-full">
              <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
              {Number(product.rating).toFixed(1)}
            </span>
          </div>
        )}

        <img
          src={product.imageMain}
          alt={product.name}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
          loading="lazy"
        />

        {/* View Details hover indicator */}
        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/95 text-[#0E1F13] text-xs font-inter font-semibold shadow-md transform translate-y-2 group-hover:translate-y-0 transition-transform duration-300">
            <span>View Details</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </span>
        </div>
      </div>

      {/* Info + actions */}
      <div className="p-5 lg:p-6 flex flex-col flex-1">
        {product.tag && (
          <p className="font-inter text-[10px] tracking-[0.2em] uppercase text-black/45 mb-2">
            {product.tag}
          </p>
        )}

        <h3 className="font-dm font-normal text-lg lg:text-xl leading-[1.15] tracking-[-0.02em] text-black line-clamp-2 min-h-[2.3em] group-hover:text-emerald-800 transition-colors">
          {product.name}
        </h3>

        {/* Price row */}
        <div className="mt-3 mb-5 flex items-baseline gap-2">
          <span className="font-dm text-2xl lg:text-[26px] font-normal tracking-[-0.03em] text-[#0E1F13]">
            ₹{product.price.toFixed(0)}
          </span>
          {product.mrp > product.price && (
            <span className="font-inter text-sm line-through text-black/40">
              ₹{product.mrp.toFixed(0)}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="mt-auto flex items-stretch gap-2">
          <button
            type="button"
            onClick={handleAdd}
            aria-label="Add to cart"
            title={justAdded ? "Added to cart" : "Add to cart"}
            className={`shrink-0 w-11 rounded-xl border border-black/15 flex items-center justify-center transition-colors ${
              justAdded ? "bg-[#2E5B32] text-white border-[#2E5B32]" : "bg-white text-[#0E1F13] hover:bg-black/5"
            }`}
          >
            {justAdded ? <CheckCircle2 className="w-4 h-4" /> : <ShoppingBag className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={handleBuyNow}
            disabled={buyingThis || isPaying}
            className="flex-1 rounded-xl bg-[#0E1F13] text-white font-inter font-medium text-[13px] tracking-[-0.01em] flex items-center justify-center gap-2 py-3 hover:bg-[#0E1F13]/90 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {buyingThis ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Opening…</span>
              </>
            ) : (
              <>
                <Zap className="w-3.5 h-3.5" />
                <span>Buy now</span>
              </>
            )}
          </button>
        </div>
      </div>
    </motion.article>
  );
}
