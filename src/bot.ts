import { Telegraf, Markup, Context } from 'telegraf';
import { DatabaseService } from './services/supabase';
import { cache, CACHE_KEYS } from './utils/cache';
import { User, Product, Order, OrderWithItems, DeliverySession } from './types';

export const bot = new Telegraf(process.env.BOT_TOKEN!);
const db = new DatabaseService();

// Session storage (in production, use Redis or similar)
const sessions = new Map<number, any>();
const deliverySessions = new Map<number, DeliverySession>();

function getSession(userId: number) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {});
  }
  return sessions.get(userId);
}

function getDeliverySession(userId: number): DeliverySession {
  if (!deliverySessions.has(userId)) {
    deliverySessions.set(userId, { step: 'side' });
  }
  return deliverySessions.get(userId)!;
}

function clearDeliverySession(userId: number): void {
  deliverySessions.delete(userId);
}

// Utility functions
function formatPrice(price: number): string {
  return `${price.toFixed(0)} ₽`;
}

function formatOrder(order: OrderWithItems): string {
  let text = `📋 Заказ #${order.id}\n`;
  text += `📅 ${new Date(order.created_at).toLocaleString('ru')}\n`;
  
  if (order.pickup_location === 'delivery') {
    text += `📍 Доставка до места\n`;
    if (order.delivery_side && order.sector && order.seat_row && order.seat_number) {
      text += `🏟️ Место: ${order.delivery_side === 'left' ? 'Левая' : 'Правая'} сторона, Сектор ${order.sector}, Ряд ${order.seat_row}, Место ${order.seat_number}\n`;
    }
  } else {
    text += `📍 ${order.pickup_location === 'left_buffer' ? 'Левый буфет' : 'Правый буфет'}\n`;
  }
  
  text += `📊 Статус: ${getStatusText(order.status)}\n\n`;
  
  text += `🛒 Состав заказа:\n`;
  for (const item of order.order_items) {
    text += `• ${item.product.name} x${item.quantity} = ${formatPrice(item.quantity * item.price_at_time)}\n`;
  }
  
  text += `\n💰 Итого: ${formatPrice(order.total_amount)}`;
  
  return text;
}

function getStatusText(status: string): string {
  const statusMap: Record<string, string> = {
    'cart': '🛒 В корзине',
    'pending': '⏳ Ожидает',
    'preparing': '👨‍🍳 Готовится',
    'ready_for_pickup': '✅ Готов к выдаче',
    'completed': '✅ Завершен',
    'cancelled': '❌ Отменен'
  };
  return statusMap[status] || status;
}

async function getCachedProducts(): Promise<Product[]> {
  let products = cache.get<Product[]>(CACHE_KEYS.PRODUCTS);
  
  if (!products) {
    products = await db.getAvailableProducts();
    cache.set(CACHE_KEYS.PRODUCTS, products, 300000); // 5 minutes
  }
  
  return products;
}

async function getCachedProductsByCategory(category: string): Promise<Product[]> {
  const cacheKey = CACHE_KEYS.PRODUCTS_BY_CATEGORY(category);
  let products = cache.get<Product[]>(cacheKey);
  
  if (!products) {
    products = await db.getProductsByCategory(category);
    cache.set(cacheKey, products, 300000); // 5 minutes
  }
  
  return products;
}

async function notifySellers(order: OrderWithItems): Promise<void> {
  try {
    if (!order.pickup_location) return;

    if (order.pickup_location === 'delivery') {
      // Notify delivery personnel
      console.log(`Notification for delivery: New order #${order.id}`);
      // Here you would send the notification to delivery personnel
    } else {
      const sellerRole = order.pickup_location === 'left_buffer' ? 'seller_left' : 'seller_right';
      console.log(`Notification for ${sellerRole}: New order #${order.id}`);
    }
    
    // In a real application, you would maintain lists of chat IDs for each role
    // and send appropriate notifications
  } catch (error) {
    console.error('Error notifying sellers:', error);
  }
}

async function notifyDeliveryPersonnel(order: OrderWithItems): Promise<void> {
  try {
    console.log(`Notification for delivery personnel: New delivery order #${order.id}`);
    // Implementation for notifying delivery personnel would go here
  } catch (error) {
    console.error('Error notifying delivery personnel:', error);
  }
}

// Bot middleware
bot.use(async (ctx, next) => {
  if (!ctx.from) return;
  
  const userId = ctx.from.id;
  let user = await db.getUserByTelegramId(userId);
  
  if (!user) {
    // Create new user
    user = await db.createOrUpdateUser({
      user_id: userId,
      username: ctx.from.username,
      full_name: ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : ''),
      role: 'customer'
    });
    
    // If user creation failed, create a temporary user object
    if (!user) {
      user = {
        user_id: userId,
        username: ctx.from.username,
        full_name: ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : ''),
        role: 'customer',
        created_at: new Date().toISOString()
      };
      console.log('Using temporary user object for:', userId);
    }
  }
  
  ctx.state.user = user;
  return next();
});

// Start command
bot.command('start', async (ctx) => {
  const user = ctx.state.user as User;
  
  if (user.role === 'customer') {
    await showCustomerMainMenu(ctx);
  } else if (user.role === 'delivery') {
    await showDeliveryMainMenu(ctx);
  } else {
    await showSellerMainMenu(ctx);
  }
});

// Customer functions
async function showCustomerMainMenu(ctx: Context) {
  const user = ctx.state.user as User;
  const cartOrder = await db.getOrCreateCartOrder(user.user_id);
  const cartItemsCount = cartOrder ? await getCartItemsCount(cartOrder.id) : 0;
  
  const keyboard = Markup.keyboard([
    ['🍿 Заказать'],
    [`🛒 Корзина (${cartItemsCount})`, '📋 Мои заказы']
  ]).resize();
  
  await ctx.reply(
    `Добро пожаловать в Popcorn Shop! 🍿\n\nВыберите действие:`,
    keyboard
  );
}

async function getCartItemsCount(orderId: number): Promise<number> {
  try {
    const order = await db.getOrderWithItems(orderId);
    return order?.order_items.reduce((sum, item) => sum + item.quantity, 0) || 0;
  } catch {
    return 0;
  }
}

// Handle customer menu
bot.hears('🍿 Заказать', async (ctx) => {
  const user = ctx.state.user as User;
  
  // Check for active orders
  const orders = await db.getOrdersByCustomer(user.user_id);
  const activeOrder = orders.find(order => 
    !['cart', 'completed', 'cancelled'].includes(order.status)
  );
  
  if (activeOrder) {
    await ctx.reply(
      `У вас есть активный заказ #${activeOrder.id}\nСтатус: ${getStatusText(activeOrder.status)}\n\nДождитесь завершения текущего заказа перед оформлением нового.`
    );
    return;
  }
  
  await showCategoriesMenu(ctx);
});

async function showCategoriesMenu(ctx: Context) {
  const keyboard = Markup.keyboard([
    ['🍿 Попкорн', '🥤 Напитки'],
    ['🍭 Сахарная вата'],
    ['⬅️ Назад']
  ]).resize();
  
  await ctx.reply('Выберите категорию:', keyboard);
}

// Category handlers
bot.hears('🍿 Попкорн', async (ctx) => {
  await showProductsInCategory(ctx, 'popcorn');
});

bot.hears('🥤 Напитки', async (ctx) => {
  await showProductsInCategory(ctx, 'drinks');
});

bot.hears('🍭 Сахарная вата', async (ctx) => {
  await showProductsInCategory(ctx, 'cotton_candy');
});

async function showProductsInCategory(ctx: Context, category: string) {
  const products = await getCachedProductsByCategory(category);
  
  if (products.length === 0) {
    await ctx.reply('В этой категории пока нет доступных товаров.');
    return;
  }
  
  const buttons = products.map(product => 
    Markup.button.callback(
      `${product.name} - ${formatPrice(product.price)}`,
      `add_product_${product.id}`
    )
  );
  
  // Add buttons in rows of 1
  const keyboard = Markup.inlineKeyboard(
    buttons.map(button => [button])
  );
  
  await ctx.reply('Выберите товар:', keyboard);
}

// Handle product selection
bot.action(/add_product_(\d+)/, async (ctx) => {
  const productId = parseInt(ctx.match[1]);
  const user = ctx.state.user as User;
  
  try {
    const products = await getCachedProducts();
    const product = products.find(p => p.id === productId);
    
    if (!product) {
      await ctx.answerCbQuery('Товар не найден');
      return;
    }
    
    const cartOrder = await db.getOrCreateCartOrder(user.user_id);
    if (!cartOrder) {
      await ctx.answerCbQuery('Ошибка создания корзины');
      return;
    }
    
    const success = await db.addItemToOrder(cartOrder.id, productId, 1, product.price);
    
    if (success) {
      await ctx.answerCbQuery(`✅ ${product.name} добавлен в корзину`);
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('➕ Еще один', `add_product_${productId}`)],
        [Markup.button.callback('🛒 Перейти в корзину', 'show_cart')],
        [Markup.button.callback('🍿 Продолжить покупки', 'continue_shopping')]
      ]);
      
      await ctx.editMessageText(
        `✅ ${product.name} добавлен в корзину!\n\nЧто дальше?`,
        keyboard
      );
    } else {
      await ctx.answerCbQuery('Ошибка добавления товара');
    }
  } catch (error) {
    console.error('Error adding product:', error);
    await ctx.answerCbQuery('Произошла ошибка');
  }
});

// Cart handlers
bot.hears(/🛒 Корзина/, async (ctx) => {
  await showCart(ctx);
});

bot.action('show_cart', async (ctx) => {
  await ctx.deleteMessage().catch(() => {});
  await showCart(ctx);
});

bot.action('continue_shopping', async (ctx) => {
  await ctx.deleteMessage().catch(() => {});
  await showCategoriesMenu(ctx);
});

async function showCart(ctx: Context) {
  const user = ctx.state.user as User;
  const cartOrder = await db.getOrCreateCartOrder(user.user_id);
  
  if (!cartOrder) {
    await ctx.reply('Ошибка получения корзины');
    return;
  }
  
  const orderWithItems = await db.getOrderWithItems(cartOrder.id);
  
  if (!orderWithItems || orderWithItems.order_items.length === 0) {
    await ctx.reply('Ваша корзина пуста. Добавьте товары для оформления заказа.');
    return;
  }
  
  let text = '🛒 Ваша корзина:\n\n';
  for (const item of orderWithItems.order_items) {
    text += `• ${item.product.name} x${item.quantity} = ${formatPrice(item.quantity * item.price_at_time)}\n`;
  }
  text += `\n💰 Итого: ${formatPrice(orderWithItems.total_amount)}`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📝 Оформить заказ', 'checkout_order')],
    [Markup.button.callback('🗑 Очистить корзину', 'clear_cart')],
    [Markup.button.callback('🍿 Продолжить покупки', 'continue_shopping')]
  ]);
  
  await ctx.reply(text, keyboard);
}

// Checkout process
bot.action('checkout_order', async (ctx) => {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📍 Левый буфет', 'pickup_left_buffer')],
    [Markup.button.callback('📍 Правый буфет', 'pickup_right_buffer')],
    [Markup.button.callback('🚚 Доставка до места', 'pickup_delivery')],
    [Markup.button.callback('⬅️ Назад', 'show_cart')]
  ]);
  
  await ctx.editMessageText(
    'Выберите способ получения заказа:',
    keyboard
  );
});

bot.action('pickup_left_buffer', async (ctx) => {
  await processCheckout(ctx, 'left_buffer');
});

bot.action('pickup_right_buffer', async (ctx) => {
  await processCheckout(ctx, 'right_buffer');
});

bot.action('pickup_delivery', async (ctx) => {
  await startDeliveryProcess(ctx);
});

async function startDeliveryProcess(ctx: Context) {
  const user = ctx.state.user as User;
  const cartOrder = await db.getOrCreateCartOrder(user.user_id);
  
  if (!cartOrder) {
    await ctx.answerCbQuery('Ошибка получения корзины');
    return;
  }
  
  // Initialize delivery session
  const deliverySession = getDeliverySession(user.user_id);
  deliverySession.orderId = cartOrder.id;
  deliverySession.step = 'side';
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('👈 Левая сторона', 'delivery_side_left')],
    [Markup.button.callback('👉 Правая сторона', 'delivery_side_right')],
    [Markup.button.callback('⬅️ Назад', 'show_cart')]
  ]);
  
  await ctx.editMessageText(
    'Выберите сторону зала:',
    keyboard
  );
}

bot.action('delivery_side_left', async (ctx) => {
  await handleDeliverySide(ctx, 'left');
});

bot.action('delivery_side_right', async (ctx) => {
  await handleDeliverySide(ctx, 'right');
});

async function handleDeliverySide(ctx: Context, side: 'left' | 'right') {
  const user = ctx.state.user as User;
  const deliverySession = getDeliverySession(user.user_id);
  deliverySession.side = side;
  deliverySession.step = 'sector';
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('1', 'delivery_sector_1')],
    [Markup.button.callback('2', 'delivery_sector_2')],
    [Markup.button.callback('3', 'delivery_sector_3')],
    [Markup.button.callback('4', 'delivery_sector_4')],
    [Markup.button.callback('⬅️ Назад', 'pickup_delivery')]
  ]);
  
  await ctx.editMessageText(
    `Выбрана ${side === 'left' ? 'левая' : 'правая'} сторона.\n\nТеперь выберите сектор:`,
    keyboard
  );
}

bot.action(/delivery_sector_(\d)/, async (ctx) => {
  const sector = parseInt(ctx.match[1]);
  await handleDeliverySector(ctx, sector);
});

async function handleDeliverySector(ctx: Context, sector: number) {
  const user = ctx.state.user as User;
  const deliverySession = getDeliverySession(user.user_id);
  deliverySession.sector = sector;
  deliverySession.step = 'row';
  
  await ctx.editMessageText(
    `Выбран сектор ${sector}.\n\nТеперь введите номер ряда (например: 5):`
  );
}

// Handle text input for row and seat
bot.on('text', async (ctx) => {
  const user = ctx.state.user as User;
  const deliverySession = getDeliverySession(user.user_id);
  const text = ctx.message.text;
  
  if (deliverySession.step === 'row') {
    deliverySession.row = text;
    deliverySession.step = 'seat';
    
    await ctx.reply(
      `Введен ряд: ${text}\n\nТеперь введите номер места (например: 12):`
    );
  } else if (deliverySession.step === 'seat') {
    deliverySession.seat = text;
    deliverySession.step = 'completed';
    
    await completeDeliveryProcess(ctx);
  } else {
    // Handle other text messages normally
    return;
  }
});

async function completeDeliveryProcess(ctx: Context) {
  const user = ctx.state.user as User;
  const deliverySession = getDeliverySession(user.user_id);
  
  if (!deliverySession.orderId || !deliverySession.side || !deliverySession.sector || !deliverySession.row || !deliverySession.seat) {
    await ctx.reply('Ошибка обработки заказа. Попробуйте еще раз.');
    clearDeliverySession(user.user_id);
    return;
  }
  
  try {
    // Update order with delivery details
    const success = await db.updateOrderDeliveryDetails(
      deliverySession.orderId,
      deliverySession.side,
      deliverySession.sector,
      deliverySession.row,
      deliverySession.seat
    );
    
    if (!success) {
      await ctx.reply('Ошибка обновления данных доставки.');
      clearDeliverySession(user.user_id);
      return;
    }
    
    // Update order status to pending with delivery location
    const orderSuccess = await db.updateOrderStatus(deliverySession.orderId, 'pending', 'delivery');
    
    if (orderSuccess) {
      const updatedOrder = await db.getOrderWithItems(deliverySession.orderId);
      if (updatedOrder) {
        await notifyDeliveryPersonnel(updatedOrder);
      }
      
      await ctx.reply(
        `✅ Заказ #${deliverySession.orderId} успешно оформлен с доставкой!\n\n` +
        `🏟️ Место доставки: ${deliverySession.side === 'left' ? 'Левая' : 'Правая'} сторона, Сектор ${deliverySession.sector}, Ряд ${deliverySession.row}, Место ${deliverySession.seat}\n` +
        `💰 Сумма: ${formatPrice(updatedOrder?.total_amount || 0)}\n\n` +
        `Ожидайте доставки заказа на ваше место.`
      );
      
      clearDeliverySession(user.user_id);
      await showCustomerMainMenu(ctx);
    } else {
      await ctx.reply('Ошибка оформления заказа.');
      clearDeliverySession(user.user_id);
    }
  } catch (error) {
    console.error('Error completing delivery process:', error);
    await ctx.reply('Произошла ошибка при оформлении заказа.');
    clearDeliverySession(user.user_id);
  }
}

async function processCheckout(ctx: Context, pickupLocation: 'left_buffer' | 'right_buffer') {
  const user = ctx.state.user as User;
  
  try {
    const cartOrder = await db.getOrCreateCartOrder(user.user_id);
    if (!cartOrder) {
      await ctx.answerCbQuery('Ошибка получения корзины');
      return;
    }
    
    const orderWithItems = await db.getOrderWithItems(cartOrder.id);
    if (!orderWithItems || orderWithItems.order_items.length === 0) {
      await ctx.answerCbQuery('Корзина пуста');
      return;
    }
    
    const success = await db.updateOrderStatus(cartOrder.id, 'pending', pickupLocation);
    
    if (success) {
      const updatedOrder = await db.getOrderWithItems(cartOrder.id);
      if (updatedOrder) {
        await notifySellers(updatedOrder);
      }
      
      await ctx.editMessageText(
        `✅ Заказ #${cartOrder.id} успешно оформлен!\n\n` +
        `📍 Место получения: ${pickupLocation === 'left_buffer' ? 'Левый буфет' : 'Правый буфет'}\n` +
        `💰 Сумма: ${formatPrice(orderWithItems.total_amount)}\n\n` +
        `Ожидайте уведомления о готовности заказа.`
      );
      
      await showCustomerMainMenu(ctx);
    } else {
      await ctx.answerCbQuery('Ошибка оформления заказа');
    }
  } catch (error) {
    console.error('Error processing checkout:', error);
    await ctx.answerCbQuery('Произошла ошибка');
  }
}

// Orders history
bot.hears('📋 Мои заказы', async (ctx) => {
  const user = ctx.state.user as User;
  const orders = await db.getOrdersByCustomer(user.user_id);
  
  if (orders.length === 0) {
    await ctx.reply('У вас пока нет заказов.');
    return;
  }
  
  // Show active orders with action buttons
  const activeOrders = orders.filter(o => ['pending', 'preparing'].includes(o.status));
  const otherOrders = orders.filter(o => !['pending', 'preparing'].includes(o.status));
  
  if (activeOrders.length > 0) {
    await ctx.reply('📋 Активные заказы:');
    
    for (const order of activeOrders) {
      const orderWithItems = await db.getOrderWithItems(order.id);
      if (orderWithItems) {
        const canCancel = ['pending', 'preparing'].includes(order.status);
        
        const keyboard = canCancel ? 
          Markup.inlineKeyboard([
            [Markup.button.callback('❌ Отменить заказ', `cancel_order_${order.id}`)]
          ]) : undefined;
        
        await ctx.reply(formatOrder(orderWithItems), keyboard);
      }
    }
  }
  
  if (otherOrders.length > 0) {
    await ctx.reply('📋 История заказов:');
    
    for (const order of otherOrders.slice(0, 10)) { // Show last 10 orders
      const orderWithItems = await db.getOrderWithItems(order.id);
      if (orderWithItems) {
        await ctx.reply(formatOrder(orderWithItems));
      }
    }
  }
});

// Order cancellation handlers
bot.action(/cancel_order_(\d+)/, async (ctx) => {
  const orderId = parseInt(ctx.match[1]);
  const user = ctx.state.user as User;
  
  try {
    // Get order details
    const order = await db.getOrderWithItems(orderId);
    if (!order) {
      await ctx.answerCbQuery('Заказ не найден');
      return;
    }
    
    // Check if user can cancel this order
    if (order.customer_id !== user.user_id && !['seller_left', 'seller_right', 'delivery'].includes(user.role)) {
      await ctx.answerCbQuery('Нет прав для отмены этого заказа');
      return;
    }
    
    // Check if order can be cancelled
    if (!['pending', 'preparing'].includes(order.status)) {
      await ctx.answerCbQuery('Этот заказ нельзя отменить');
      return;
    }
    
    // Confirm cancellation
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('✅ Да, отменить', `confirm_cancel_${orderId}`)],
      [Markup.button.callback('❌ Нет, вернуться', 'cancel_cancellation')]
    ]);
    
    await ctx.editMessageText(
      `❓ Вы уверены, что хотите отменить заказ #${orderId}?\n\n` +
      `💰 Сумма: ${formatPrice(order.total_amount)}\n` +
      `📊 Статус: ${getStatusText(order.status)}`,
      keyboard
    );
    
  } catch (error) {
    console.error('Error showing cancel confirmation:', error);
    await ctx.answerCbQuery('Произошла ошибка');
  }
});

bot.action(/confirm_cancel_(\d+)/, async (ctx) => {
  const orderId = parseInt(ctx.match[1]);
  const user = ctx.state.user as User;
  
  try {
    const success = await db.cancelOrder(orderId);
    
    if (success) {
      await ctx.editMessageText(
        `✅ Заказ #${orderId} успешно отменен.`
      );
      
      // Notify relevant parties about cancellation
      const order = await db.getOrderWithItems(orderId);
      if (order && user.role === 'customer') {
        console.log(`Customer cancelled order #${orderId}`);
      } else if (order && ['seller_left', 'seller_right', 'delivery'].includes(user.role)) {
        console.log(`User ${user.role} cancelled order #${orderId}`);
        // TODO: Notify customer about cancellation
      }
      
    } else {
      await ctx.editMessageText('❌ Не удалось отменить заказ. Попробуйте позже.');
    }
    
  } catch (error) {
    console.error('Error cancelling order:', error);
    await ctx.editMessageText('❌ Произошла ошибка при отмене заказа.');
  }
});

bot.action('cancel_cancellation', async (ctx) => {
  await ctx.editMessageText('❌ Отмена заказа отменена.');
});

// Seller functions
async function showSellerMainMenu(ctx: Context) {
  const keyboard = Markup.keyboard([
    ['📥 Новые заказы', '👨‍🍳 В работе'],
    ['✅ Готовые заказы']
  ]).resize();
  
  await ctx.reply('Панель продавца:', keyboard);
}

// Delivery functions
async function showDeliveryMainMenu(ctx: Context) {
  const keyboard = Markup.keyboard([
    ['📦 Новые заказы', '🚚 В доставке'],
    ['✅ Доставленные заказы']
  ]).resize();
  
  await ctx.reply('Панель доставки:', keyboard);
}

bot.hears('📦 Новые заказы', async (ctx) => {
  const user = ctx.state.user as User;
  if (user.role !== 'delivery') return;
  
  const orders = await db.getPendingDeliveryOrders();
  
  if (orders.length === 0) {
    await ctx.reply('Нет новых заказов на доставку.');
    return;
  }
  
  for (const order of orders) {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🚚 Взять в доставку', `take_delivery_${order.id}`)],
      [Markup.button.callback('❌ Отменить заказ', `cancel_order_${order.id}`)]
    ]);
    
    await ctx.reply(formatOrder(order), keyboard);
  }
});

bot.hears('🚚 В доставке', async (ctx) => {
  const user = ctx.state.user as User;
  if (user.role !== 'delivery') return;
  
  const orders = await db.getActiveDeliveryOrders();
  const preparingOrders = orders.filter(o => o.status === 'preparing');
  
  if (preparingOrders.length === 0) {
    await ctx.reply('Нет заказов в доставке.');
    return;
  }
  
  for (const order of preparingOrders) {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('✅ Доставлено', `complete_delivery_${order.id}`)],
      [Markup.button.callback('❌ Отменить заказ', `cancel_order_${order.id}`)]
    ]);
    
    await ctx.reply(formatOrder(order), keyboard);
  }
});

// Delivery actions
bot.action(/take_delivery_(\d+)/, async (ctx) => {
  const orderId = parseInt(ctx.match[1]);
  
  try {
    const success = await db.atomicStatusUpdate(orderId, 'pending', 'preparing');
    
    if (success) {
      await ctx.answerCbQuery('✅ Заказ взят в доставку');
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } else {
      await ctx.answerCbQuery('❌ Заказ уже взят другим курьером');
    }
  } catch (error) {
    console.error('Error taking delivery order:', error);
    await ctx.answerCbQuery('Произошла ошибка');
  }
});

bot.action(/complete_delivery_(\d+)/, async (ctx) => {
  const orderId = parseInt(ctx.match[1]);
  
  try {
    const success = await db.updateOrderStatus(orderId, 'completed');
    
    if (success) {
      await ctx.answerCbQuery('✅ Заказ доставлен');
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      
      // Notify customer
      const order = await db.getOrderWithItems(orderId);
      if (order) {
        try {
          await bot.telegram.sendMessage(
            order.customer_id,
            `🔔 Ваш заказ был доставлен! Спасибо за заказ!\n\n${formatOrder(order)}`
          );
        } catch (error) {
          console.log('Could not notify customer:', error);
        }
      }
    } else {
      await ctx.answerCbQuery('Ошибка обновления статуса');
    }
  } catch (error) {
    console.error('Error completing delivery:', error);
    await ctx.answerCbQuery('Произошла ошибка');
  }
});

// Seller handlers (existing)
bot.hears('📥 Новые заказы', async (ctx) => {
  const user = ctx.state.user as User;
  if (user.role === 'customer') return;
  
  const orders = await db.getPendingOrdersForSeller(user.role as any);
  
  if (orders.length === 0) {
    await ctx.reply('Нет новых заказов.');
    return;
  }
  
  for (const order of orders) {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('👨‍🍳 Взять в работу', `take_order_${order.id}`)],
      [Markup.button.callback('❌ Отменить заказ', `cancel_order_${order.id}`)]
    ]);
    
    await ctx.reply(formatOrder(order), keyboard);
  }
});

bot.hears('👨‍🍳 В работе', async (ctx) => {
  const user = ctx.state.user as User;
  if (user.role === 'customer') return;
  
  const orders = await db.getActiveOrdersForSeller(user.role as any);
  const preparingOrders = orders.filter(o => o.status === 'preparing');
  
  if (preparingOrders.length === 0) {
    await ctx.reply('Нет заказов в работе.');
    return;
  }
  
  for (const order of preparingOrders) {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('✅ Готово', `ready_order_${order.id}`)],
      [Markup.button.callback('❌ Отменить заказ', `cancel_order_${order.id}`)]
    ]);
    
    await ctx.reply(formatOrder(order), keyboard);
  }
});

bot.hears('✅ Готовые заказы', async (ctx) => {
  const user = ctx.state.user as User;
  if (user.role === 'customer') return;
  
  const orders = await db.getActiveOrdersForSeller(user.role as any);
  const readyOrders = orders.filter(o => o.status === 'ready_for_pickup');
  
  if (readyOrders.length === 0) {
    await ctx.reply('Нет готовых заказов.');
    return;
  }
  
  for (const order of readyOrders) {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📦 Выдан', `complete_order_${order.id}`)]
    ]);
    
    await ctx.reply(formatOrder(order), keyboard);
  }
});

// Seller actions (existing)
bot.action(/take_order_(\d+)/, async (ctx) => {
  const orderId = parseInt(ctx.match[1]);
  
  try {
    const success = await db.atomicStatusUpdate(orderId, 'pending', 'preparing');
    
    if (success) {
      await ctx.answerCbQuery('✅ Заказ взят в работу');
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } else {
      await ctx.answerCbQuery('❌ Заказ уже взят другим продавцом');
    }
  } catch (error) {
    console.error('Error taking order:', error);
    await ctx.answerCbQuery('Произошла ошибка');
  }
});

bot.action(/ready_order_(\d+)/, async (ctx) => {
  const orderId = parseInt(ctx.match[1]);
  
  try {
    const success = await db.updateOrderStatus(orderId, 'ready_for_pickup');
    
    if (success) {
      await ctx.answerCbQuery('✅ Заказ готов к выдаче');
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      
      // Notify customer
      const order = await db.getOrderWithItems(orderId);
      if (order) {
        try {
          await bot.telegram.sendMessage(
            order.customer_id,
            `🔔 Ваш заказ готов к получению!\n\n${formatOrder(order)}`
          );
        } catch (error) {
          console.log('Could not notify customer:', error);
        }
      }
    } else {
      await ctx.answerCbQuery('Ошибка обновления статуса');
    }
  } catch (error) {
    console.error('Error marking order ready:', error);
    await ctx.answerCbQuery('Произошла ошибка');
  }
});

bot.action(/complete_order_(\d+)/, async (ctx) => {
  const orderId = parseInt(ctx.match[1]);
  
  try {
    const success = await db.updateOrderStatus(orderId, 'completed');
    
    if (success) {
      await ctx.answerCbQuery('✅ Заказ выдан');
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } else {
      await ctx.answerCbQuery('Ошибка обновления статуса');
    }
  } catch (error) {
    console.error('Error completing order:', error);
    await ctx.answerCbQuery('Произошла ошибка');
  }
});

// Clear cart
bot.action('clear_cart', async (ctx) => {
  // Implementation for clearing cart would go here
  await ctx.answerCbQuery('Функция очистки корзины будет добавлена');
});

// Back navigation
bot.hears('⬅️ Назад', async (ctx) => {
  const user = ctx.state.user as User;
  if (user.role === 'customer') {
    await showCustomerMainMenu(ctx);
  } else if (user.role === 'delivery') {
    await showDeliveryMainMenu(ctx);
  } else {
    await showSellerMainMenu(ctx);
  }
});

// Error handling
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  ctx.reply('Произошла ошибка. Попробуйте еще раз.').catch(() => {});
});

export default bot;
