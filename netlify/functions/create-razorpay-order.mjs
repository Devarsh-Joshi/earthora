// netlify/functions/create-razorpay-order.mjs
// Server-side function — fetches product prices from Supabase, computes the
// authoritative total, then creates a Razorpay order with `line_items_total`
// so Magic Checkout (1-click) can render address + payment in one modal.
// The client-supplied amount is NEVER trusted.

const KEY_ID               = process.env.RAZORPAY_KEY_ID           ?? '';
const KEY_SECRET           = process.env.RAZORPAY_KEY_SECRET        ?? '';
const NETLIFY_INTERNAL_KEY = process.env.NETLIFY_INTERNAL_KEY       ?? '';
const SUPABASE_URL         = process.env.VITE_SUPABASE_URL          ?? '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY  ?? '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Internal-Key',
};

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey':        SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase REST error: ${res.status}`);
  return res.json();
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const reqKey = event.headers['x-internal-key'] || '';
  if (NETLIFY_INTERNAL_KEY && reqKey !== NETLIFY_INTERNAL_KEY) {
    return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  if (!KEY_ID || !KEY_SECRET) {
    console.error('Razorpay credentials are not configured.');
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Payment gateway not configured.' }) };
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Supabase credentials are not configured.');
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Database not configured.' }) };
  }

  let cartItems, currency, receipt;
  try {
    ({ cartItems, currency = 'INR', receipt } = JSON.parse(event.body ?? '{}'));
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }

  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Cart is empty.' }) };
  }

  try {
    // 1. Fetch product prices from DB — never trust client-supplied prices
    const productIds = [...new Set(cartItems.map(i => String(i.productId || '')).filter(Boolean))];
    if (productIds.length === 0) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'No valid product IDs.' }) };
    }

    const idList = productIds.map(id => `"${id.replace(/"/g, '')}"`).join(',');
    const products = await sbGet(
      `products?or=(id.in.(${idList}),slug.in.(${idList}))&status=neq.archived&select=id,slug,name,price`
    );

    if (!products || products.length === 0) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'No active products found in cart.' }) };
    }

    // 2. Compute server-side subtotal + build line_items for Magic Checkout
    const productMap = new Map();
    for (const p of products) {
      productMap.set(p.id,   p);
      productMap.set(p.slug, p);
    }

    let subtotalPaise = 0;
    const lineItems = [];
    for (const item of cartItems) {
      const pid = String(item.productId || '');
      const prod = productMap.get(pid);
      if (!prod) continue;

      const unitPrice = Number(prod.price);

      const qty = Math.max(1, Math.round(Number(item.quantity) || 1));
      const unitPaise = Math.round(unitPrice * 100);
      subtotalPaise += unitPaise * qty;

      lineItems.push({
        sku: prod.slug || prod.id,
        variant_id: prod.id,
        price: unitPaise,
        offer_price: unitPaise,
        tax_amount: 0,
        quantity: qty,
        name: prod.name || prod.slug || 'Earthora product',
        description: prod.name || '',
        weight: 0,
        dimensions: {},
        image_url: '',
        product_url: '',
        notes: {},
      });
    }

    if (subtotalPaise < 100) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Order total is below the minimum amount.' }) };
    }

    const totalPaise = subtotalPaise;

    // 4. Create Razorpay order — include line_items_total so 1CC accepts it
    const authHeader = 'Basic ' + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64');
    const razorRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify({
        amount:  totalPaise,
        currency,
        receipt: receipt || `rcpt_${Date.now()}`,
        line_items_total: totalPaise,
        line_items: lineItems,
      }),
    });

    if (!razorRes.ok) {
      const errText = await razorRes.text().catch(() => '');
      console.error('Razorpay create-order error:', razorRes.status, errText);
      return { statusCode: 502, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Failed to create Razorpay order. Please try again.' }) };
    }

    const order = await razorRes.json();

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: order.id,
        amount:   order.amount,   // server-computed paise — use this for Razorpay modal
        currency: order.currency,
        key_id:   KEY_ID,
      }),
    };
  } catch (err) {
    console.error('Function error:', err);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Internal server error.' }) };
  }
}
