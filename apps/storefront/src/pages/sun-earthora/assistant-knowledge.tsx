import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, X, Leaf, BookOpen, CheckCircle2, Circle, Archive, Trash2, Edit2, ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { supabase } from "@/lib/supabase";

// Manages product_knowledge — the approved source the website chat assistant
// may answer from for benefits/dosage/warnings/etc. Nothing here is used until
// status is set to "approved".

const CATEGORIES = [
  "description", "benefits", "dosage", "directions", "ingredients",
  "warnings", "contraindications", "storage", "faq",
] as const;
type Category = (typeof CATEGORIES)[number];

interface ProductOption {
  id: string;
  name: string;
}

interface KnowledgeEntry {
  id: string;
  productId: string;
  category: Category;
  question: string | null;
  content: string;
  status: "draft" | "approved" | "archived";
  version: number;
  locale: string;
}

const statusStyles: Record<KnowledgeEntry["status"], string> = {
  approved: "bg-green-50 text-green-700 border-green-200",
  draft: "bg-amber-50 text-amber-700 border-amber-200",
  archived: "bg-gray-50 text-gray-500 border-gray-200",
};

const categoryLabel = (c: string) =>
  c.charAt(0).toUpperCase() + c.slice(1).replace(/-/g, " ");

async function mutateKnowledge(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("manage-product-knowledge", {
    body, headers: { "x-admin-password": sessionStorage.getItem("admin_password") || "" },
  });
  return { error: error || (data?.ok === true ? null : new Error(data?.error || "Knowledge update failed")) };
}

interface SelectOption { value: string; label: string }

function CustomSelect({
  value,
  onChange,
  options,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (val: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full h-11 px-4 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all flex items-center justify-between gap-3 text-left"
      >
        <span className={selected ? "text-foreground" : "text-foreground/30"}>
          {selected ? selected.label : placeholder}
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}>
          <ChevronDown className="w-4 h-4 text-foreground/40 shrink-0" strokeWidth={2} />
        </motion.span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="absolute z-30 w-full mt-1.5 bg-white border border-border/30 rounded-xl shadow-xl shadow-black/5 overflow-hidden"
          >
            <ul className="max-h-56 overflow-y-auto py-1.5">
              {options.map((opt) => {
                const active = opt.value === value;
                return (
                  <li key={opt.value}>
                    <button
                      type="button"
                      onClick={() => { onChange(opt.value); setOpen(false); }}
                      className={`w-full px-4 py-2.5 text-sm text-left flex items-center justify-between gap-3 transition-colors ${
                        active
                          ? "text-primary font-semibold bg-primary/5"
                          : "text-foreground/80 hover:bg-muted/60"
                      }`}
                    >
                      {opt.label}
                      {active && <Check className="w-3.5 h-3.5 text-primary shrink-0" strokeWidth={2.5} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function AdminAssistantKnowledge() {
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { toast } = useToast();

  useEscapeKey(() => setShowForm(false), showForm);

  const [form, setForm] = useState({
    category: "benefits" as Category,
    locale: "en-IN",
    question: "",
    content: "",
  });

  const fetchProducts = async () => {
    const { data, error } = await supabase.from("products").select("id, name").neq("status", "archived").order("name");
    if (!error && data) {
      setProducts(data as ProductOption[]);
      if (!selectedProductId && data.length > 0) setSelectedProductId((data[0] as ProductOption).id);
    }
  };

  const fetchEntries = async (productId: string) => {
    if (!productId) return;
    setLoading(true);
    const { data, error } = await (supabase.from("product_knowledge") as any)
      .select("id, product_id, category, question, content, status, version, locale")
      .eq("product_id", productId)
      .order("category")
      .order("version", { ascending: false });

    if (error) {
      toast({ title: "Fetch failed", description: error.message, variant: "destructive" });
      setEntries([]);
    } else {
      setEntries(
        (data ?? []).map((r: any) => ({
          id: r.id, productId: r.product_id, category: r.category,
          question: r.question, content: r.content, status: r.status, version: r.version, locale: r.locale || "en-IN",
        }))
      );
    }
    setLoading(false);
  };

  useEffect(() => { fetchProducts(); }, []);
  useEffect(() => { if (selectedProductId) fetchEntries(selectedProductId); }, [selectedProductId]);

  const openCreateForm = () => {
    setEditingId(null);
    setForm({ category: "benefits", locale: "en-IN", question: "", content: "" });
    setShowForm(true);
  };

  const openEditForm = (entry: KnowledgeEntry) => {
    setEditingId(entry.id);
    setForm({ category: entry.category, locale: entry.locale, question: entry.question ?? "", content: entry.content });
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!form.content.trim()) {
      toast({ title: "Missing content", description: "Approved content text is required." });
      return;
    }

    try {
      if (editingId) {
        const { error } = await mutateKnowledge({ action: "update", id: editingId, ...form });
        if (error) throw error;
        toast({ title: "Entry updated" });
      } else {
        const { error } = await mutateKnowledge({
          action: "create",
          product_id: selectedProductId,
          category: form.category,
          locale: form.locale,
          question: form.question || null,
          content: form.content,
          status: "draft",
        });
        if (error) throw error;
        toast({ title: "Entry created", description: "Approve it when ready for the chat assistant." });
      }
      setShowForm(false);
      fetchEntries(selectedProductId);
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    }
  };

  const handleSetStatus = async (id: string, status: KnowledgeEntry["status"]) => {
    const { error } = await mutateKnowledge({ action: "status", id, status });
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    fetchEntries(selectedProductId);
  };

  const handleDelete = async (id: string) => {
    const { error } = await mutateKnowledge({ action: "delete", id });
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Entry deleted" });
    fetchEntries(selectedProductId);
  };

  return (
    <>
      <motion.div key="assistant-knowledge" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
        <div className="mb-6 p-4 rounded-2xl bg-primary/5 border border-primary/10 flex items-start gap-3">
          <BookOpen className="w-4 h-4 text-primary shrink-0 mt-0.5" strokeWidth={1.5} />
          <p className="text-xs text-foreground/60 leading-relaxed">
            The website chat assistant uses the approved product knowledge here. Information must
            have status <strong>Approved</strong>. Draft and archived entries are never used,
            even if requested directly. Edits return to Draft for re-approval. Medical safety rules still apply.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <CustomSelect
              value={selectedProductId}
              onChange={setSelectedProductId}
              options={products.map((p) => ({ value: p.id, label: p.name }))}
              placeholder="Select a product"
              className="min-w-[220px]"
            />
            <span className="text-xs text-foreground/30">{entries.length} entries</span>
          </div>
          <Button className="gap-1.5 h-11 px-5 shadow-md" onClick={openCreateForm} disabled={!selectedProductId}>
            <Plus className="w-4 h-4" strokeWidth={2} />
            Add Entry
          </Button>
        </div>

        <div className="space-y-3">
          {loading ? (
            <div className="text-center py-20 text-foreground/40 text-xs">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="text-center py-20 bg-white border border-border/40 rounded-2xl text-foreground/40 font-medium">
              No knowledge entries yet for this product.
            </div>
          ) : (
            entries.map((entry, i) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: i * 0.03 }}
                className="bg-white rounded-2xl border border-border/40 p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="px-2.5 py-0.5 rounded-full bg-muted text-foreground/60 text-[11px] font-semibold uppercase tracking-wide">{entry.category}</span>
                      <span className="text-[10px] text-foreground/40">{entry.locale}</span>
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${statusStyles[entry.status]}`}>{entry.status}</span>
                      <span className="text-[10px] text-foreground/30">v{entry.version}</span>
                    </div>
                    {entry.question && <p className="text-xs font-medium text-foreground/70 mb-1">Q: {entry.question}</p>}
                    <p className="text-sm text-foreground/80 leading-relaxed">{entry.content}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {entry.status !== "approved" && (
                      <button onClick={() => handleSetStatus(entry.id, "approved")} title="Approve" className="p-2 rounded-lg text-foreground/30 hover:text-green-600 hover:bg-green-50 transition-colors">
                        <CheckCircle2 className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                    )}
                    {entry.status !== "draft" && (
                      <button onClick={() => handleSetStatus(entry.id, "draft")} title="Set to draft" className="p-2 rounded-lg text-foreground/30 hover:text-amber-600 hover:bg-amber-50 transition-colors">
                        <Circle className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                    )}
                    {entry.status !== "archived" && (
                      <button onClick={() => handleSetStatus(entry.id, "archived")} title="Archive" className="p-2 rounded-lg text-foreground/30 hover:text-gray-600 hover:bg-gray-50 transition-colors">
                        <Archive className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                    )}
                    <button onClick={() => openEditForm(entry)} title="Edit" className="p-2 rounded-lg text-foreground/30 hover:text-primary hover:bg-primary/5 transition-colors">
                      <Edit2 className="w-4 h-4" strokeWidth={1.5} />
                    </button>
                    <button onClick={() => handleDelete(entry.id)} title="Delete" className="p-2 rounded-lg text-foreground/30 hover:text-red-500 hover:bg-red-50 transition-colors">
                      <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {showForm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={() => setShowForm(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-4 md:inset-x-1/4 md:inset-y-24 z-50 bg-background md:rounded-2xl overflow-hidden flex flex-col shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-6 md:px-8 h-16 border-b border-border/30 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><BookOpen className="w-4 h-4 text-primary" strokeWidth={1.5} /></div>
                  <h2 className="text-sm font-serif font-bold text-foreground">{editingId ? "Edit Entry" : "New Knowledge Entry"}</h2>
                </div>
                <button onClick={() => setShowForm(false)} className="p-2 rounded-full hover:bg-muted transition-colors"><X className="w-5 h-5 text-foreground/60" /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 md:p-8">
                <div className="max-w-lg mx-auto space-y-5">
                  <div>
                    <label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-1.5 block">Agent language</label>
                    <CustomSelect
                      value={form.locale}
                      onChange={(locale) => setForm({ ...form, locale })}
                      options={[
                        { value: "en-IN", label: "English" },
                        { value: "hi-IN", label: "Hindi" },
                        { value: "hi-Latn", label: "Hinglish" },
                        { value: "gu-IN", label: "Gujarati" },
                        { value: "gu-Latn", label: "Gujlish" },
                      ]}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-1.5 block">Category</label>
                    <CustomSelect
                      value={form.category}
                      onChange={(val) => setForm({ ...form, category: val as Category })}
                      options={CATEGORIES.map((c) => ({ value: c, label: categoryLabel(c) }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-1.5 block">Caller Question (optional)</label>
                    <input
                      type="text"
                      value={form.question}
                      onChange={(e) => setForm({ ...form, question: e.target.value })}
                      placeholder="e.g. Is this safe during pregnancy?"
                      className="w-full h-11 px-4 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all placeholder:text-foreground/25"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-1.5 block">Approved Content *</label>
                    <textarea
                      value={form.content}
                      onChange={(e) => setForm({ ...form, content: e.target.value })}
                      rows={6}
                      placeholder="Exactly what the assistant is allowed to say — keep it short and clear."
                      className="w-full px-4 py-3 text-sm bg-white border border-border/40 rounded-xl outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/5 transition-all resize-none placeholder:text-foreground/25"
                    />
                  </div>
                  <p className="text-[11px] text-foreground/40">
                    New entries save as <strong>Draft</strong> — approve them from the list once reviewed.
                  </p>
                  <div className="flex items-center justify-end gap-3 pt-5 border-t border-border/20">
                    <Button variant="outline" onClick={() => setShowForm(false)} className="h-11 px-6">Cancel</Button>
                    <Button onClick={handleSubmit} className="h-11 px-8 gap-2 shadow-md">
                      <Leaf className="w-4 h-4" strokeWidth={1.5} />
                      {editingId ? "Save Changes" : "Create Entry"}
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
