import threeProductHero from "@assets/generated_images/earthora_hero_three_products.png";

export function Hero() {
  return (
    <section
      className="earthora-hero relative flex min-h-[520px] items-start overflow-hidden bg-no-repeat pt-28 pb-[48vw] selection:bg-white selection:text-black sm:min-h-[640px] sm:pb-[40vw] xl:h-[clamp(600px,72vh,760px)] xl:min-h-0 xl:items-center xl:pt-20 xl:pb-6"
      style={{ backgroundImage: `url("${threeProductHero}")` }}
    >
      <div aria-hidden className="earthora-hero-scrim pointer-events-none absolute inset-0" />

      <div
        className="relative z-10 mx-auto w-full"
        style={{ maxWidth: 1500, padding: "0 clamp(20px, 4vw, 56px)" }}
      >
        <h1
          className="max-w-[620px] font-dm font-normal text-white"
          style={{
            fontSize: "clamp(32px, 6vw, 100px)",
            lineHeight: 0.94,
            letterSpacing: "-0.045em",
          }}
        >
          <span className="flex flex-wrap items-baseline" style={{ gap: "0.2em", padding: "2px 0" }}>
            <span className="overflow-hidden inline-block animate-word-reveal delay-300">
              <span className="inline-block text-white">The</span>
            </span>
            <span className="overflow-hidden inline-block animate-word-reveal delay-400">
              <span className="inline-block text-white">Power</span>
            </span>
            <span className="overflow-hidden inline-block animate-word-reveal delay-500">
              <span className="inline-block text-white/50">of</span>
            </span>
          </span>

          <span className="flex flex-wrap items-baseline" style={{ gap: "0.2em", padding: "2px 0" }}>
            <span className="overflow-hidden inline-block animate-word-reveal delay-600">
              <span className="inline-block text-white/50">Nature</span>
            </span>
            <span className="overflow-hidden inline-block animate-word-reveal delay-700">
              <span className="inline-block text-white/50">in</span>
            </span>
            <span className="overflow-hidden inline-block animate-word-reveal delay-800">
              <span className="inline-block text-white">Every</span>
            </span>
          </span>

          <span className="flex flex-wrap items-center" style={{ gap: "0.2em", padding: "2px 0" }}>
            <span className="overflow-hidden inline-block animate-word-reveal delay-900">
              <span className="inline-block text-white">Tablet</span>
            </span>
          </span>
        </h1>
      </div>
    </section>
  );
}
