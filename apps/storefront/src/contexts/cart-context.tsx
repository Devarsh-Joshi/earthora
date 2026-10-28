import { createContext, useContext, useState, useEffect, useMemo, useCallback, type ReactNode } from 'react';
import { fetchCatalog } from '@/lib/api';
import type { CartItem } from '@/types';

interface CartContextType {
  items: CartItem[];
  addToCart: (item: Omit<CartItem, 'quantity'>) => void;
  removeFromCart: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  cartCount: number;
}

const CART_KEY = 'earthora-cart';

const CartContext = createContext<CartContextType | null>(null);

// Helper to consolidate items by ID or Name into single combined entries with summed quantities
function consolidateCartItems(rawItems: CartItem[]): CartItem[] {
  if (!rawItems || rawItems.length === 0) return [];
  const map = new Map<string, CartItem>();

  for (const item of rawItems) {
    if (!item) continue;
    // Key by ID or Name to catch identical products added under different IDs or names
    const key = (item.id || item.name || "").trim().toLowerCase();
    if (!key) continue;

    const existing = map.get(key);
    if (existing) {
      existing.quantity += Number(item.quantity || 1);
    } else {
      map.set(key, { ...item, quantity: Number(item.quantity || 1) });
    }
  }

  return Array.from(map.values());
}

function loadCart(): CartItem[] {
  try {
    const saved = localStorage.getItem(CART_KEY);
    return saved ? consolidateCartItems(JSON.parse(saved)) : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(loadCart);

  useEffect(() => {
    localStorage.setItem(CART_KEY, JSON.stringify(consolidateCartItems(items)));
  }, [items]);

  // Validate cart against live product list — removes items for deleted products
  useEffect(() => {
    if (items.length === 0) return;
    fetchCatalog()
      .then(({ products }) => {
        const data = products.filter((p) => p.status !== 'archived') as unknown as Record<string, unknown>[] | null;
        if (!data) return;
        const valid = new Set(data.flatMap((p: any) => [p.id, p.slug].filter(Boolean)));
        setItems((prev) => {
          const filtered = prev.filter((item) => valid.has(item.id) || valid.has(item.name));
          return filtered.length !== prev.length ? filtered : prev;
        });
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addToCart = useCallback(
    (product: Omit<CartItem, 'quantity'>) => {
      setItems((prev) => {
        const prodKey = (product.id || product.name || "").trim().toLowerCase();
        const existingIndex = prev.findIndex(
          (i) => (i.id || i.name || "").trim().toLowerCase() === prodKey
        );

        if (existingIndex >= 0) {
          const next = prev.map((item, idx) =>
            idx === existingIndex ? { ...item, quantity: item.quantity + 1 } : item
          );
          return consolidateCartItems(next);
        }

        return consolidateCartItems([...prev, { ...product, quantity: 1 }]);
      });
    },
    []
  );

  const removeFromCart = useCallback(
    (id: string) => {
      const matchKey = (id || "").trim().toLowerCase();
      setItems((prev) =>
        prev.filter((i) => (i.id || i.name || "").trim().toLowerCase() !== matchKey)
      );
    },
    []
  );

  const updateQuantity = useCallback(
    (id: string, quantity: number) => {
      if (quantity < 1) return removeFromCart(id);
      const matchKey = (id || "").trim().toLowerCase();

      setItems((prev) =>
        consolidateCartItems(
          prev.map((i) =>
            (i.id || i.name || "").trim().toLowerCase() === matchKey
              ? { ...i, quantity }
              : i
          )
        )
      );
    },
    [removeFromCart]
  );

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  const cartCount = useMemo(() => items.reduce((sum, i) => sum + i.quantity, 0), [items]);

  return (
    <CartContext.Provider value={{ items, addToCart, removeFromCart, updateQuantity, clearCart, cartCount }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextType {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within a CartProvider');
  return ctx;
}
