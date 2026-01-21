// In-memory store for development when Supabase RLS is problematic
import { User, Product, Order, OrderItem, OrderWithItems } from '../types';

class MemoryStore {
  private users = new Map<number, User>();
  private orders = new Map<number, Order>();
  private orderItems = new Map<number, OrderItem[]>();
  private products: Product[] = [
    { id: 1, name: 'Сэндвич', category: 'food', price: 350, is_available: true },
    { id: 2, name: 'Бутерброд', category: 'food', price: 350, is_available: true },
    { id: 3, name: 'Бутерброд рыба', category: 'food', price: 650, is_available: true },
    { id: 4, name: 'Шоколадка', category: 'sweets', price: 150, is_available: true },
    { id: 5, name: 'Сосиска в тесте', category: 'food', price: 170, is_available: true },
    { id: 6, name: 'Донат', category: 'sweets', price: 190, is_available: true },
    { id: 7, name: 'Тарталетки', category: 'food', price: 350, is_available: true },
    { id: 8, name: 'Пицца', category: 'food', price: 270, is_available: true },
    { id: 9, name: 'ХотДог', category: 'food', price: 350, is_available: true },
    { id: 10, name: 'Трубочка', category: 'sweets', price: 190, is_available: true },
    { id: 11, name: 'Сок', category: 'drinks', price: 170, is_available: true },
    { id: 12, name: 'Вода', category: 'drinks', price: 150, is_available: true },
    { id: 13, name: 'Черноголовка, Пепси', category: 'drinks', price: 270, is_available: true },
    { id: 14, name: 'Холодный чай', category: 'drinks', price: 270, is_available: true },
    { id: 15, name: 'Маленький кофе', category: 'drinks', price: 270, is_available: true },
    { id: 16, name: 'Какао', category: 'drinks', price: 320, is_available: true },
    { id: 17, name: 'Большой кофе', category: 'drinks', price: 370, is_available: true },
    { id: 18, name: 'Чай', category: 'drinks', price: 170, is_available: true },
    { id: 19, name: 'Попкорн Соль M', category: 'popcorn', price: 270, is_available: true },
    { id: 20, name: 'Попкорн Карамель M', category: 'popcorn', price: 370, is_available: true },
    { id: 21, name: 'Попкорн Фруктовый M', category: 'popcorn', price: 370, is_available: true },
    { id: 22, name: 'Попкорн Сыр M', category: 'popcorn', price: 320, is_available: true },
    { id: 23, name: 'Соль L', category: 'popcorn', price: 470, is_available: true },
    { id: 24, name: 'Карам L', category: 'popcorn', price: 670, is_available: true },
    { id: 25, name: 'Фрукт L', category: 'popcorn', price: 670, is_available: true },
    { id: 26, name: 'Сыр L', category: 'popcorn', price: 570, is_available: true },
    { id: 27, name: 'Вата', category: 'sweets', price: 350, is_available: true },
    { id: 28, name: 'Усы', category: 'toys', price: 350, is_available: true },
    { id: 29, name: 'Брецель дог', category: 'food', price: 250, is_available: true },
    { id: 30, name: 'Мармелад, Орешки', category: 'food', price: 300, is_available: true },
    { id: 31, name: 'Яблочные чипсы', category: 'food', price: 300, is_available: true },
    { id: 32, name: 'Пряник', category: 'sweets', price: 300, is_available: true },
    { id: 33, name: 'Мороженое ГуМ', category: 'ice_cream', price: 370, is_available: true },
    { id: 34, name: 'Слаш', category: 'drinks', price: 470, is_available: true },
    { id: 35, name: 'Бабл Ти', category: 'drinks', price: 470, is_available: true },
    { id: 36, name: 'Дом.Лимонад', category: 'drinks', price: 350, is_available: true },
    { id: 37, name: 'Носик', category: 'toys', price: 270, is_available: true },
    { id: 38, name: 'Клоун', category: 'toys', price: 770, is_available: true },
    { id: 39, name: 'Бабочка', category: 'toys', price: 750, is_available: true },
    { id: 40, name: 'Чай б', category: 'drinks', price: 320, is_available: true },
    { id: 41, name: 'Шар', category: 'toys', price: 450, is_available: true }
  ];
  
  private nextOrderId = 1;
  private nextOrderItemId = 1;

  // User operations
  createOrUpdateUser(userData: Partial<User>): User {
    const user: User = {
      user_id: userData.user_id!,
      username: userData.username,
      full_name: userData.full_name,
      role: userData.role || 'customer',
      created_at: new Date().toISOString()
    };
    
    this.users.set(user.user_id, user);
    return user;
  }

  getUserByTelegramId(telegramId: number): User | null {
    return this.users.get(telegramId) || null;
  }

  // Product operations
  getAvailableProducts(): Product[] {
    return this.products.filter(p => p.is_available);
  }

  getProductsByCategory(category: string): Product[] {
    return this.products.filter(p => p.category === category && p.is_available);
  }

  getProductById(id: number): Product | undefined {
    return this.products.find(p => p.id === id);
  }

  // Order operations
  getOrCreateCartOrder(customerId: number): Order {
    // Find existing cart
    const existingCart = Array.from(this.orders.values()).find(
      order => order.customer_id === customerId && order.status === 'cart'
    );
    
    if (existingCart) {
      return existingCart;
    }

    // Create new cart
    const newOrder: Order = {
      id: this.nextOrderId++,
      customer_id: customerId,
      status: 'cart',
      total_amount: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    this.orders.set(newOrder.id, newOrder);
    this.orderItems.set(newOrder.id, []);
    return newOrder;
  }

  addItemToOrder(orderId: number, productId: number, quantity: number, price: number): boolean {
    try {
      const items = this.orderItems.get(orderId) || [];
      const existingItem = items.find(item => item.product_id === productId);

      if (existingItem) {
        existingItem.quantity += quantity;
      } else {
        const newItem: OrderItem = {
          id: this.nextOrderItemId++,
          order_id: orderId,
          product_id: productId,
          quantity,
          price_at_time: price
        };
        items.push(newItem);
      }

      this.orderItems.set(orderId, items);
      this.updateOrderTotal(orderId);
      return true;
    } catch (error) {
      console.error('Error adding item to order:', error);
      return false;
    }
  }

  updateOrderTotal(orderId: number): void {
    const items = this.orderItems.get(orderId) || [];
    const total = items.reduce((sum, item) => sum + (item.quantity * item.price_at_time), 0);
    
    const order = this.orders.get(orderId);
    if (order) {
      order.total_amount = total;
      order.updated_at = new Date().toISOString();
      this.orders.set(orderId, order);
    }
  }

  getOrderWithItems(orderId: number): OrderWithItems | null {
    const order = this.orders.get(orderId);
    if (!order) return null;

    const items = this.orderItems.get(orderId) || [];
    const itemsWithProducts = items.map(item => ({
      ...item,
      product: this.getProductById(item.product_id)!
    }));

    return {
      ...order,
      order_items: itemsWithProducts
    };
  }

  updateOrderStatus(orderId: number, status: Order['status'], pickupLocation?: string, deliveryDetails?: Partial<Order>): boolean {
    const order = this.orders.get(orderId);
    if (!order) return false;

    order.status = status;
    order.updated_at = new Date().toISOString();
    
    if (pickupLocation) {
      order.pickup_location = pickupLocation as any;
    }

    if (deliveryDetails && pickupLocation === 'delivery') {
      if (deliveryDetails.delivery_side) order.delivery_side = deliveryDetails.delivery_side;
      if (deliveryDetails.sector) order.sector = deliveryDetails.sector;
      if (deliveryDetails.seat_row) order.seat_row = deliveryDetails.seat_row;
      if (deliveryDetails.seat_number) order.seat_number = deliveryDetails.seat_number;
    }

    this.orders.set(orderId, order);
    return true;
  }

  getOrdersByCustomer(customerId: number): Order[] {
    return Array.from(this.orders.values())
      .filter(order => order.customer_id === customerId && order.status !== 'cart')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  getPendingOrdersForSeller(sellerRole: 'seller_left' | 'seller_right'): OrderWithItems[] {
    const location = sellerRole === 'seller_left' ? 'left_buffer' : 'right_buffer';
    
    return Array.from(this.orders.values())
      .filter(order => order.pickup_location === location && order.status === 'pending')
      .map(order => this.getOrderWithItems(order.id)!)
      .filter(order => order !== null)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }

  getActiveOrdersForSeller(sellerRole: 'seller_left' | 'seller_right'): OrderWithItems[] {
    const location = sellerRole === 'seller_left' ? 'left_buffer' : 'right_buffer';
    
    return Array.from(this.orders.values())
      .filter(order => 
        order.pickup_location === location && 
        ['preparing', 'ready_for_pickup'].includes(order.status)
      )
      .map(order => this.getOrderWithItems(order.id)!)
      .filter(order => order !== null)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }

  atomicStatusUpdate(orderId: number, expectedStatus: string, newStatus: string): boolean {
    const order = this.orders.get(orderId);
    if (!order || order.status !== expectedStatus) {
      return false;
    }

    order.status = newStatus as Order['status'];
    order.updated_at = new Date().toISOString();
    this.orders.set(orderId, order);
    return true;
  }
}

export const memoryStore = new MemoryStore();