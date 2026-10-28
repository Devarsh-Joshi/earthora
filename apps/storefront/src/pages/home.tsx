import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Hero } from "@/components/sections/Hero";
import { HomeProducts } from "@/components/sections/HomeProducts";

export default function Home() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#FAF9F5] text-black selection:bg-primary/20">
      <Navbar />
      <main className="flex-1">
        <Hero />
        <HomeProducts />
      </main>
      <Footer />
    </div>
  );
}
