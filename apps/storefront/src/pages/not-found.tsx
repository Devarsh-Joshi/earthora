import { motion } from "framer-motion";
import { Link } from "wouter";
import { ArrowUpRight, Leaf, Compass } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import heroLeaves from "@assets/generated_images/hero_leaves.jpg";

// Site palette — matches the hero + Products + Benefits sections.
const CREAM       = "#FAF9F5";
const OFF_WHITE   = "#FEFDF9";
const DEEP_FOREST = "#0E1F13";
const MID_FOREST  = "#2E5B32";
const GOLD        = "#E6C670";

export default function NotFound() {
  return (
    <div className="min-h-[100dvh] flex flex-col" style={{ backgroundColor: CREAM }}>
      <Navbar />

      <main
        className="relative flex-1 flex items-center overflow-hidden"
        style={{
          paddingTop: "clamp(96px, 10vw, 132px)",
          paddingBottom: "clamp(48px, 6vw, 96px)",
        }}
      >
        {/* Faint dot texture — matches the rest of the site */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.05] pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(circle, ${DEEP_FOREST} 1px, transparent 1px)`,
            backgroundSize: "26px 26px",
          }}
        />

        {/* Warm gold bloom, top-right */}
        <div
          aria-hidden
          className="absolute -top-24 -right-24 rounded-full pointer-events-none opacity-30 blur-3xl"
          style={{
            width: "clamp(360px, 40vw, 620px)",
            height: "clamp(360px, 40vw, 620px)",
            backgroundColor: GOLD,
          }}
        />

        {/* Sage bloom, bottom-left */}
        <div
          aria-hidden
          className="absolute -bottom-24 -left-24 rounded-full pointer-events-none opacity-20 blur-3xl"
          style={{
            width: "clamp(360px, 40vw, 620px)",
            height: "clamp(360px, 40vw, 620px)",
            backgroundColor: MID_FOREST,
          }}
        />

        <div
          className="relative z-10 mx-auto w-full"
          style={{ maxWidth: 1400, padding: "0 clamp(24px, 5vw, 72px)" }}
        >
          <div
            className="grid items-center"
            style={{
              gridTemplateColumns: "minmax(0, 1.05fr) minmax(0, 1fr)",
              gap: "clamp(32px, 5vw, 96px)",
            }}
          >
            {/* ── LEFT: giant 404 + editorial copy ── */}
            <div className="flex flex-col items-start">
              {/* Overline */}
              <motion.span
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.05 }}
                className="inline-flex items-center gap-2 rounded-full border"
                style={{
                  borderColor: `${DEEP_FOREST}22`,
                  backgroundColor: OFF_WHITE,
                  padding: "6px 14px",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.25em",
                  textTransform: "uppercase",
                  color: `${DEEP_FOREST}b3`,
                  marginBottom: "clamp(20px, 2.4vw, 32px)",
                }}
              >
                <Leaf className="w-3 h-3" style={{ color: MID_FOREST }} strokeWidth={2} />
                Error 404 · Off the trail
              </motion.span>

              {/* Editorial "404" numeral — the visual anchor */}
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
                className="font-dm font-normal leading-none"
                style={{
                  fontSize: "clamp(120px, 22vw, 280px)",
                  color: `${DEEP_FOREST}12`,
                  letterSpacing: "-0.06em",
                  marginBottom: "clamp(-32px, -3vw, -48px)",
                }}
                aria-hidden
              >
                404
              </motion.div>

              {/* Headline */}
              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.25 }}
                className="font-dm font-normal"
                style={{
                  color: DEEP_FOREST,
                  fontSize: "clamp(38px, 5vw, 76px)",
                  lineHeight: 0.98,
                  letterSpacing: "-0.04em",
                  maxWidth: "18ch",
                }}
              >
                This leaf drifted{" "}
                <em className="not-italic" style={{ color: `${DEEP_FOREST}55` }}>
                  somewhere else.
                </em>
              </motion.h1>

              {/* Sub-copy */}
              <motion.p
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.35 }}
                className="font-inter"
                style={{
                  color: `${DEEP_FOREST}a8`,
                  marginTop: "clamp(20px, 2.4vw, 32px)",
                  maxWidth: 440,
                  fontSize: "clamp(14px, 1.05vw, 17px)",
                  lineHeight: 1.55,
                }}
              >
                The page you're looking for doesn't exist — or was never planted
                here to begin with. Let's get you back on the path.
              </motion.p>

              {/* CTA row */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.45 }}
                className="flex items-center flex-wrap"
                style={{
                  marginTop: "clamp(28px, 3vw, 40px)",
                  gap: "clamp(16px, 2vw, 28px)",
                }}
              >
                <Link
                  href="/"
                  className="text-white rounded-full font-inter font-medium tracking-[-0.01em] inline-flex items-center gap-2 hover:scale-[1.02] active:scale-[0.98] transition-transform shadow-xl group"
                  style={{
                    backgroundColor: DEEP_FOREST,
                    padding: "0 clamp(24px, 2.6vw, 34px)",
                    height: "clamp(52px, 5vw, 62px)",
                    fontSize: "clamp(14px, 1.05vw, 16px)",
                  }}
                >
                  <span>Back to home</span>
                  <ArrowUpRight
                    size={18}
                    className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform"
                  />
                </Link>

                <Link
                  href="/#products"
                  className="inline-flex items-center gap-2 font-inter font-medium underline underline-offset-4 decoration-1"
                  style={{
                    color: `${DEEP_FOREST}cc`,
                    fontSize: "clamp(13px, 1vw, 15px)",
                  }}
                >
                  <Compass className="w-4 h-4" />
                  Explore the range
                </Link>
              </motion.div>

              {/* Recovery links */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.6 }}
                className="w-full"
                style={{
                  marginTop: "clamp(32px, 3.5vw, 48px)",
                  paddingTop: "clamp(18px, 2vw, 26px)",
                  borderTop: `1px solid ${DEEP_FOREST}15`,
                  maxWidth: 520,
                }}
              >
                <p
                  className="font-inter"
                  style={{
                    color: `${DEEP_FOREST}66`,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.22em",
                    textTransform: "uppercase",
                    marginBottom: 12,
                  }}
                >
                  Or find your way to
                </p>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  {[
                    { label: "Our story",        href: "/our-story" },
                    { label: "Health benefits",  href: "/health-benefits" },
                    { label: "Contact us",       href: "/contact" },
                    { label: "FAQ",              href: "/faq" },
                  ].map(({ label, href }) => (
                    <Link
                      key={label}
                      href={href}
                      className="font-inter font-medium hover:underline underline-offset-4"
                      style={{
                        color: DEEP_FOREST,
                        fontSize: "clamp(12px, 0.9vw, 14px)",
                      }}
                    >
                      {label}
                    </Link>
                  ))}
                </div>
              </motion.div>
            </div>

            {/* ── RIGHT: botanical vignette ── */}
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
              className="hidden lg:block relative"
              aria-hidden
            >
              <div
                className="relative overflow-hidden rounded-[36px] shadow-[0_40px_80px_-20px_rgba(14,31,19,0.4)]"
                style={{ aspectRatio: "4 / 5" }}
              >
                <img
                  src={heroLeaves}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                />
                {/* Warm scrim so the callout inside stays readable */}
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(6,18,10,0.15) 0%, rgba(6,18,10,0.15) 55%, rgba(6,18,10,0.75) 100%)",
                  }}
                />

                {/* Bottom quote strip */}
                <div
                  className="absolute bottom-0 left-0 right-0 p-6 lg:p-8 text-white"
                >
                  <span
                    className="inline-block mb-3 rounded-full backdrop-blur-md"
                    style={{
                      backgroundColor: "rgba(230,198,112,0.2)",
                      border: "1px solid rgba(230,198,112,0.4)",
                      padding: "4px 12px",
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.22em",
                      textTransform: "uppercase",
                      color: GOLD,
                    }}
                  >
                    From the field
                  </span>
                  <p
                    className="font-dm"
                    style={{
                      fontSize: "clamp(20px, 2vw, 28px)",
                      lineHeight: 1.2,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    "The best paths through a farm are the ones you weren't
                    looking for."
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
