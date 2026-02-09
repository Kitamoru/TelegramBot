export interface User {
  user_id: number;
  username?: string;
  full_name?: string;
  role: 'customer' | 'seller_left' | 'seller_right' | 'delivery';
  created_at: string;
}

export interface Product {
  id: number;
  name: string;
  category: 'popcorn' | 'drinks' | 'cotton_candy' | 'food' | 'sweets' | 'toys' | 'ice_cream';
  price: number;
  is_available: boolean;
}

export interface Order {
  id: number;
  customer_id: number;
  status: 'cart' | 'pending' | 'preparing' | 'ready_for_pickup' | 'completed' | 'cancelled';
  pickup_location?: 'left_buffer' | 'right_buffer' | 'delivery';
  delivery_side?: 'left' | 'right';
  sector?: number;
  seat_row?: string;
  seat_number?: string;
  total_amount: number;
  pickup_time?: string;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: number;
  order_id: number;
  product_id: number;
  quantity: number;
  price_at_time: number;
}

export interface OrderWithItems extends Order {
  order_items: (OrderItem & { product: Product })[];
}

export type BotContext = any;