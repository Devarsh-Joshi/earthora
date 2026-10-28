import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Instagram, Facebook, Leaf, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { publicProductsQuery } from "@/lib/catalogQuery";
import type { Product } from "@/types";

/** Strip brand prefix tokens so long product names are short in the footer */
function shortenName(name: string): string {
  return name
    .replace(/^morilife\+?\s*/i, '')   // remove brand prefix
    .replace(/\bleaf\b\s*/i, '')        // remove "Leaf"
    .trim();
}


const exploreLinks = [
  { label: "Our Story", href: "/our-story" },
  { label: "Health Benefits", href: "/health-benefits" },
];

const supportLinks = [
  { label: "Contact Us", href: "/contact" },
  { label: "Shipping Policy", href: "/shipping-policy" },
  { label: "FAQ", href: "/faq" },
];

const socialLinks = [
  { Icon: Instagram, label: "Instagram", href: "https://www.instagram.com/earthorafarms" },
  { Icon: Facebook,  label: "Facebook",  href: "https://www.facebook.com/earthorafarms" },
];

export function Footer() {
  const [newsletterEmail, setNewsletterEmail] = useState("");
  const [newsletterLoading, setNewsletterLoading] = useState(false);
  const { toast } = useToast();

  const { data: products = [] } = useQuery<Product[]>({
    ...publicProductsQuery,
  });

  const handleNewsletter = async () => {
    const email = newsletterEmail.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: "Invalid email", description: "Please enter a valid email address.", variant: "destructive" });
      return;
    }
    setNewsletterLoading(true);
    try {
      const { error } = await (supabase.from("Contact_details") as any).insert({
        contact_name: "Newsletter",
        contact_email: email,
        contact_phone: "",
        contact_topic: "Newsletter Subscription",
        contact_message: "User subscribed to the Earthora Farms wellness newsletter.",
      });
      if (error && !error.message?.includes("duplicate")) throw error;
      setNewsletterEmail("");
      toast({ title: "You're in!", description: "Welcome to the Earthora Farms wellness community." });
    } catch {
      toast({ title: "Subscription failed", description: "Please try again or email us directly.", variant: "destructive" });
    } finally {
      setNewsletterLoading(false);
    }
  };

  return (
    <footer className="bg-[#0F2318] text-white selection:bg-white selection:text-black">
      {/* Top Section */}
      <div className="container mx-auto px-6 sm:px-10 max-w-[1400px] pt-16 lg:pt-24 pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16">
          {/* Brand Column */}
          <div className="lg:col-span-5">
            {/* Logo */}
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 rounded-full bg-emerald-700 flex items-center justify-center">
                <Leaf className="w-4 h-4 text-white" />
              </div>
              <span className="font-dm font-medium text-[26px] tracking-[-0.05em] text-white">
                Earthora
              </span>
            </div>

            <p className="font-inter font-normal text-sm sm:text-base text-white/55 leading-[1.7] tracking-[-0.02em] max-w-[380px] mb-8">
              Pure, shade-dried Moringa oleifera grown in volcanic soil. No additives. No compromises. Just the ancient tree of life, reimagined for your modern wellness ritual.
            </p>



            {/* Social Icons */}
            <div className="flex items-center gap-3">
              {socialLinks.map(({ Icon, label, href }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="w-10 h-10 rounded-full border border-white/15 flex items-center justify-center text-white/50 hover:text-white hover:border-white/40 transition-all"
                >
                  <Icon className="w-4 h-4" />
                </a>
              ))}
            </div>
          </div>

          {/* Links Columns */}
          <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-3 gap-10 lg:pt-2">
            {/* Shop — dynamically populated from live product catalogue */}
            <div>
              <h4 className="font-dm font-medium text-sm text-white mb-5 tracking-[0.03em] uppercase">
                Shop
              </h4>
              <ul className="space-y-3">
                {products.map((product) => (
                  <li key={product.id}>
                    <Link
                      href={`/product/${product.id}`}
                      className="font-inter text-sm text-white/50 hover:text-white transition-colors tracking-[-0.01em]"
                    >
                      {shortenName(product.name)}
                    </Link>
                  </li>
                ))}
                {products.length > 0 && (
                  <li>
                    <Link
                      href="/#products"
                      className="font-inter text-sm font-medium text-white/70 hover:text-white transition-colors tracking-[-0.01em] inline-flex items-center gap-1"
                    >
                      View all →
                    </Link>
                  </li>
                )}
                {products.length === 0 && (
                  <li>
                    <Link
                      href="/#products"
                      className="font-inter text-sm text-white/50 hover:text-white transition-colors tracking-[-0.01em]"
                    >
                      View All Products
                    </Link>
                  </li>
                )}
              </ul>
            </div>

            {/* Explore */}
            <div>
              <h4 className="font-dm font-medium text-sm text-white mb-5 tracking-[0.03em] uppercase">
                Explore
              </h4>
              <ul className="space-y-3">
                {exploreLinks.map(({ label, href }) => (
                  <li key={label}>
                    <Link
                      href={href}
                      className="font-inter text-sm text-white/50 hover:text-white transition-colors tracking-[-0.01em]"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Support */}
            <div>
              <h4 className="font-dm font-medium text-sm text-white mb-5 tracking-[0.03em] uppercase">
                Support
              </h4>
              <ul className="space-y-3">
                {supportLinks.map(({ label, href }) => (
                  <li key={label}>
                    <Link
                      href={href}
                      className="font-inter text-sm text-white/50 hover:text-white transition-colors tracking-[-0.01em]"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Large Brand Wordmark Divider */}
      <div className="border-t border-white/8 overflow-hidden">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px]">
          <p
            className="font-dm font-normal tracking-[-0.05em] text-white/5 select-none pointer-events-none"
            style={{ fontSize: "clamp(80px, 15vw, 240px)", lineHeight: 0.85 }}
            aria-hidden="true"
          >
            Earthora
          </p>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-white/8">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px] py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="font-inter text-xs text-white/30 tracking-[-0.01em]">
            © {new Date().getFullYear()} Earthora Farms Pvt. Ltd. All rights reserved.
          </p>
          <div className="flex items-center gap-6 font-inter text-xs text-white/30">
            <a href="/privacy-policy" className="hover:text-white/70 transition-colors">Privacy Policy</a>
            <a href="/terms-of-use" className="hover:text-white/70 transition-colors">Terms of Use</a>
            <a href="/cookie-settings" className="hover:text-white/70 transition-colors">Cookie Settings</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
