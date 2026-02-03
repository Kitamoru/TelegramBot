import { createClient } from '@supabase/supabase-js';
import { User, Product, Order, OrderItem, OrderWithItems } from '../types';
import { memoryStore } from './memory-store';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

// Use memory store for development when Supabase RLS is problematic
const USE_MEMORY_STORE = false;

export class DatabaseService {
  // User operations
  async createOrUpdateUser(userData: Partial<User>): Promise<User | null> {
    if (USE_MEMORY_STORE) {
      return memoryStore.createOrUpdateUser(userData);
    }
    
    try {
      // First try to insert
      const { data: insertData, error: insertError } = await supabase
        .from('profiles')
        .insert(userData)
        .select()
        .single();

      if (!insertError) {
        return insertData;
      }

      // If insert fails due to duplicate, try update
      if (insertError.code === '23505') { // unique violation
        const { data: updateData, error: updateError } = await supabase
          .from('profiles')
          .update(userData)
          .eq('user_id', userData.user_id)
          .select()
          .single();

        if (!updateError) {
          return updateData;
        }
      }

      console.error('Error creating/updating user:', insertError);
      return null;
    } catch (error) {
      console.error('Exception in createOrUpdateUser:', error);
      return null;
    }
  }

  async getUserByTelegramId(telegramId: number): Promise<User | null> {
    if (USE_MEMORY_STORE) {
      return memoryStore.getUserByTelegramId(telegramId);
    }
    
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', telegramId)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error getting user:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Exception in getUserByTelegramId:', error);
      return null;
    }
  }

  // Product operations
  async getAvailableProducts(): Promise<Product[]> {
    if (USE_MEMORY_STORE) {
      return memoryStore.getAvailableProducts();
    }
    
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('is_available', true)
        .order('category, name');

      if (error) {
        console.error('Error getting products:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Exception in getAvailableProducts:', error);
      return [];
    }
  }

  async getProductsByCategory(category: string): Promise<Product[]> {
    if (USE_MEMORY_STORE) {
      return memoryStore.getProductsByCategory(category);
    }
    
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('category', category)
        .eq('is_available', true)
        .order('name');

      if (error) {
        console.error('Error getting products by category:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Exception in getProductsByCategory:', error);
      return [];
    }
  }

  // Order operations
  async getOrCreateCartOrder(customerId: number): Promise<Order | null> {
    if (USE_MEMORY_STORE) {
      return memoryStore.getOrCreateCartOrder(customerId);
    }
    
    try {
      // First try to get existing cart
      const { data: existingCart, error: getError } = await supabase
        .from('orders')
        .select('*')
        .eq('customer_id', customerId)
        .eq('status', 'cart')
        .single();

      if (getError && getError.code !== 'PGRST116') {
        console.error('Error getting cart:', getError);
        return null;
      }

      if (existingCart) {
        return existingCart;
      }

      // Create new cart
      const { data: newCart, error: createError } = await supabase
        .from('orders')
        .insert({
          customer_id: customerId,
          status: 'cart',
          total_amount: 0
        })
        .select()
        .single();

      if (createError) {
        console.error('Error creating cart:', createError);
        return null;
      }

      return newCart;
    } catch (error) {
      console.error('Exception in getOrCreateCartOrder:', error);
      return null;
    }
  }

  async addItemToOrder(orderId: number, productId: number, quantity: number, price: number): Promise<boolean> {
    if (USE_MEMORY_STORE) {
      return memoryStore.addItemToOrder(orderId, productId, quantity, price);
    }
    
    try {
      // Check if item already exists
      const { data: existingItem } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', orderId)
        .eq('product_id', productId)
        .single();

      if (existingItem) {
        // Update quantity
        const { error } = await supabase
          .from('order_items')
          .update({ quantity: existingItem.quantity + quantity })
          .eq('id', existingItem.id);

        if (error) {
          console.error('Error updating order item:', error);
          return false;
        }
      } else {
        // Add new item
        const { error } = await supabase
          .from('order_items')
          .insert({
            order_id: orderId,
            product_id: productId,
            quantity,
            price_at_time: price
          });

        if (error) {
          console.error('Error adding order item:', error);
          return false;
        }
      }

      // Update order total
      await this.updateOrderTotal(orderId);
      return true;
    } catch (error) {
      console.error('Exception in addItemToOrder:', error);
      return false;
    }
  }

  async updateOrderTotal(orderId: number): Promise<void> {
    try {
      const { data: items } = await supabase
        .from('order_items')
        .select('quantity, price_at_time')
        .eq('order_id', orderId);

      if (!items) return;

      const total = items.reduce((sum, item) => sum + (item.quantity * item.price_at_time), 0);

      await supabase
        .from('orders')
        .update({ total_amount: total })
        .eq('id', orderId);
    } catch (error) {
      console.error('Exception in updateOrderTotal:', error);
    }
  }

  async getOrderWithItems(orderId: number): Promise<OrderWithItems | null> {
    if (USE_MEMORY_STORE) {
      return memoryStore.getOrderWithItems(orderId);
    }
    
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          order_items (
            *,
            product:products (*)
          )
        `)
        .eq('id', orderId)
        .single();

      if (error) {
        console.error('Error getting order with items:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Exception in getOrderWithItems:', error);
      return null;
    }
  }

  async updateOrderStatus(orderId: number, status: Order['status'], pickupLocation?: string, deliveryDetails?: Partial<Order>): Promise<boolean> {
    if (USE_MEMORY_STORE) {
      return memoryStore.updateOrderStatus(orderId, status, pickupLocation, deliveryDetails);
    }
    
    try {
      const updateData: any = { status };
      if (pickupLocation) {
        updateData.pickup_location = pickupLocation;
      }

      // Try updating with all fields
      if (deliveryDetails && pickupLocation === 'delivery') {
        if (deliveryDetails.delivery_side) updateData.delivery_side = deliveryDetails.delivery_side;
        if (deliveryDetails.sector) updateData.sector = deliveryDetails.sector;
        if (deliveryDetails.seat_row) updateData.seat_row = deliveryDetails.seat_row;
        if (deliveryDetails.seat_number) updateData.seat_number = deliveryDetails.seat_number;
      }

      const { error } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', orderId);

      if (error) {
        console.error('Error updating order status:', error);
        
        // If it failed due to missing columns, fall back to basic update but LOG the data
        if (error.message?.includes('column') || error.code === 'PGRST204') {
          console.warn('FALLBACK: Schema cache issue. Delivery details lost to DB but logging here:', deliveryDetails);
          
          const basicUpdateData: any = { status };
          if (pickupLocation) basicUpdateData.pickup_location = pickupLocation;
          
          const { error: basicError } = await supabase
            .from('orders')
            .update(basicUpdateData)
            .eq('id', orderId);
            
          return !basicError;
        }
        return false;
      }

      return true;
    } catch (error) {
      console.error('Exception in updateOrderStatus:', error);
      return false;
    }
  }

  async getOrdersByCustomer(customerId: number): Promise<Order[]> {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('customer_id', customerId)
        .neq('status', 'cart')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error getting orders by customer:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Exception in getOrdersByCustomer:', error);
      return [];
    }
  }

  async getPendingOrdersForSeller(sellerRole: 'seller_left' | 'seller_right'): Promise<OrderWithItems[]> {
    try {
      const location = sellerRole === 'seller_left' ? 'left_buffer' : 'right_buffer';
      
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          order_items (
            *,
            product:products (*)
          )
        `)
        .eq('pickup_location', location)
        .eq('status', 'pending')
        .order('created_at');

      if (error) {
        console.error('Error getting pending orders for seller:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Exception in getPendingOrdersForSeller:', error);
      return [];
    }
  }

  async getActiveOrdersForSeller(sellerRole: 'seller_left' | 'seller_right'): Promise<OrderWithItems[]> {
    try {
      const location = sellerRole === 'seller_left' ? 'left_buffer' : 'right_buffer';
      
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          order_items (
            *,
            product:products (*)
          )
        `)
        .eq('pickup_location', location)
        .in('status', ['preparing', 'ready_for_pickup'])
        .order('created_at');

      if (error) {
        console.error('Error getting active orders for seller:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Exception in getActiveOrdersForSeller:', error);
      return [];
    }
  }

  async getPendingDeliveryOrders(): Promise<OrderWithItems[]> {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          order_items (
            *,
            product:products (*)
          )
        `)
        .eq('pickup_location', 'delivery')
        .eq('status', 'pending')
        .order('created_at');

      if (error) {
        console.error('Error getting pending delivery orders:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Exception in getPendingDeliveryOrders:', error);
      return [];
    }
  }

  async getActiveDeliveryOrders(): Promise<OrderWithItems[]> {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          order_items (
            *,
            product:products (*)
          )
        `)
        .eq('pickup_location', 'delivery')
        .in('status', ['preparing', 'ready_for_pickup'])
        .order('created_at');

      if (error) {
        console.error('Error getting active delivery orders:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Exception in getActiveDeliveryOrders:', error);
      return [];
    }
  }

  // Atomic order status update with race condition protection
  async atomicStatusUpdate(orderId: number, expectedStatus: string, newStatus: string): Promise<boolean> {
    if (USE_MEMORY_STORE) {
      return memoryStore.atomicStatusUpdate(orderId, expectedStatus, newStatus);
    }
    
    try {
      const { data, error } = await supabase
        .from('orders')
        .update({ 
          status: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', orderId)
        .eq('status', expectedStatus) // Only update if current status matches expected
        .select();

      if (error) {
        console.error('Error in atomic status update:', error);
        return false;
      }

      // Return true if exactly one row was updated
      return data && data.length === 1;
    } catch (error) {
      console.error('Exception in atomicStatusUpdate:', error);
      return false;
    }
  }

  async updateItemQuantity(orderId: number, productId: number, quantity: number): Promise<boolean> {
    if (USE_MEMORY_STORE) {
      return memoryStore.updateItemQuantity(orderId, productId, quantity);
    }
    
    try {
      const { error } = await supabase
        .from('order_items')
        .update({ quantity })
        .eq('order_id', orderId)
        .eq('product_id', productId);

      if (error) {
        console.error('Error updating item quantity:', error);
        return false;
      }

      await this.updateOrderTotal(orderId);
      return true;
    } catch (error) {
      console.error('Exception in updateItemQuantity:', error);
      return false;
    }
  }

  async removeItemFromOrder(orderId: number, productId: number): Promise<boolean> {
    if (USE_MEMORY_STORE) {
      return memoryStore.removeItemFromOrder(orderId, productId);
    }
    
    try {
      const { error } = await supabase
        .from('order_items')
        .delete()
        .eq('order_id', orderId)
        .eq('product_id', productId);

      if (error) {
        console.error('Error removing item from order:', error);
        return false;
      }

      await this.updateOrderTotal(orderId);
      return true;
    } catch (error) {
      console.error('Exception in removeItemFromOrder:', error);
      return false;
    }
  }

  async clearCart(orderId: number): Promise<boolean> {
    if (USE_MEMORY_STORE) {
      return memoryStore.clearCart(orderId);
    }
    
    try {
      const { error } = await supabase
        .from('order_items')
        .delete()
        .eq('order_id', orderId);

      if (error) {
        console.error('Error clearing cart items:', error);
        return false;
      }

      await this.updateOrderTotal(orderId);
      return true;
    } catch (error) {
      console.error('Exception in clearCart:', error);
      return false;
    }
  }
}