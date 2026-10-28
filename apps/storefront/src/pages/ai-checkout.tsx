import { useEffect, useState } from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { api } from '@/lib/apiClient';
import { useCheckout, type CheckoutCustomer } from '@/hooks/useCheckout';
import type { CartItem } from '@/types';

type Review = {customer: CheckoutCustomer; items: {productId: string; name: string; quantity: number; unitPrice: number}[]; pricing: {total: number}; available: boolean};
const fields: [keyof CheckoutCustomer, string][] = [['name','Full name'],['email','Email'],['phone','Phone'],['address','Delivery address'],['city','City'],['state','State'],['zip','Postal code'],['country','Country']];

export default function AiCheckout({params}: {params: {token: string}}) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const {runCheckout, isPaying} = useCheckout();
  useEffect(() => {
    let cancelled = false;
    setReview(null); setError('');
    api<Review>('/api/platform/checkout/' + encodeURIComponent(params.token)).then(value => {if (!cancelled) setReview(value);}).catch(() => {if (!cancelled) setError('This review link is unavailable or expired. Ask Eva to prepare a new checkout.');});
    return () => {cancelled = true;};
  }, [params.token]);
  const total = review?.items.reduce((sum,item) => sum + item.unitPrice * item.quantity, 0) ?? 0;
  return <div className="min-h-[100dvh] flex flex-col bg-[#FAF9F5] text-black">
    <Navbar />
    <main className="flex-1 pt-32 pb-20 px-6 w-full max-w-3xl mx-auto">
      <h1 className="font-dm text-3xl sm:text-4xl mb-3">Review your order</h1>
      <p className="text-sm text-black/60 mb-8">Eva has prepared your items and delivery details. Review them below, then complete payment yourself in secure checkout.</p>
      {error && <p role="alert" className="p-4 border border-red-200 bg-red-50 rounded-xl text-red-800">{error}</p>}
      {!review && !error && <p role="status">Loading your order…</p>}
      {success ? <p role="status">Payment confirmed. Your order number is {success}.</p> : review && <form onSubmit={async event => {
        event.preventDefault();
        if (!review.available || isPaying) return;
        const items: CartItem[] = review.items.map(item => ({id:item.productId,name:item.name,quantity:item.quantity,price:item.unitPrice,image:''}));
        const result = await runCheckout(items, review.customer);
        if (result) setSuccess(result.orderNumber);
      }}>
        <section className="bg-[#FEFDF9] border border-black/10 rounded-2xl p-6 mb-6">
          <h2 className="font-dm text-xl mb-4">Your items</h2>
          {review.items.map(item => <div className="flex flex-wrap gap-3 items-center justify-between py-3 border-b border-black/5" key={item.productId}>
            <span>{item.name} · ₹{item.unitPrice.toFixed(2)} each</span>
            <label className="text-sm">Quantity <input aria-label={'Quantity for ' + item.name} type="number" min="1" max="50" required disabled={isPaying} className="w-16 border rounded px-2 py-1 ml-2" value={item.quantity} onChange={event => setReview({...review,items:review.items.map(line => line.productId === item.productId ? {...line,quantity:Number(event.target.value)} : line)})}/></label>
          </div>)}
          <p className="font-medium mt-4">Items subtotal: ₹{total.toFixed(2)}</p>
          <p className="text-xs text-black/60 mt-2">Current prices and availability are checked again when you continue.</p>
        </section>
        <section className="bg-[#FEFDF9] border border-black/10 rounded-2xl p-6 mb-6">
          <h2 className="font-dm text-xl mb-4">Delivery details</h2>
          <div className="grid sm:grid-cols-2 gap-4">{fields.map(([key,label]) => <label key={key} className={'text-sm block ' + (key === 'address' ? 'sm:col-span-2' : '')}>
            {label}<input autoComplete={key === 'name' ? 'name' : key === 'email' ? 'email' : key === 'phone' ? 'tel' : key === 'address' ? 'street-address' : 'off'} type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'} required maxLength={key === 'address' ? 500 : key === 'email' ? 255 : 120} disabled={isPaying} className="mt-2 w-full bg-[#F4F3EE] border border-black/15 rounded-xl px-4 py-3 focus:outline-2 focus:outline-[#245b40]" value={review.customer[key]} onChange={event => setReview({...review,customer:{...review.customer,[key]:event.target.value}})}/>
          </label>)}</div>
        </section>
        {!review.available && <p role="alert" className="text-red-800 mb-4">Some items are unavailable in the requested quantity. Ask Eva to update your cart.</p>}
        <button type="submit" disabled={isPaying || !review.available || !review.items.length} className="w-full bg-[#245b40] text-white font-medium rounded-xl px-6 py-4 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#245b40]">{isPaying ? 'Opening secure payment…' : 'Continue to secure payment'}</button>
        <p className="text-sm text-black/60 mt-4">No order is placed until payment is verified. Eva does not enter card, UPI, OTP or other payment details.</p>
      </form>}
    </main><Footer />
  </div>;
}
