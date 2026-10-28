export interface CartItem {
  id: string;
  name: string;
  price: number;
  image: string;
  quantity: number;
}

export interface Product {
  id: string;
  name: string;
  mrp: number;
  price: number;
  discount: number;
  rating: number;
  reviewCount: number;
  tag: string;
  imageMain: string;
  imageHover: string;
  allImages: string[];
  badge: string;
  stock: string;
  highlights: string[];
  description: string;
}

export interface Review {
  name: string;
  rating: number;
  comment: string;
  date: string;
}

export interface DbReview {
  review_product_id: string;
  review_user_id: string;
  review_rating: string;
  review_comment: string;
  review_created_at: string;
}

export interface DbProduct {
  id: string;
  name: string;
  slug: string;
  price: number;
  mrp: number;
  status: string;
  tag: string;
  badge: string;
  description: string;
  highlights: string[];
  images: { url: string; is_primary: boolean }[];
  rating: number;
  inventory: { total_stock: number }[];
  created_at: string;
}

export interface DbUser {
  id: number;
  user_email: string;
  user_name: string;
  user_phone?: string;
  user_address?: string;
  user_city?: string;
  user_state?: string;
  user_zip?: string;
  user_country?: string;
  user_gst?: string;
  user_created_at?: string;
}

export interface DbOrder {
  id: string;
  order_number: string;
  user_id: string;
  status: string;
  total_amount: number;
  shipping_address: Record<string, any>;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  customer_address?: string;
  customer_city?: string;
  customer_state?: string;
  customer_zip?: string;
  customer_country?: string;
  customer_gst?: string;
  created_at?: string;
}

export interface DbOrderItem {
  id: number;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  created_at?: string;
}

