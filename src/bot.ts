import { Telegraf, Markup, Context } from 'telegraf';
import { DatabaseService } from './services/supabase';
import { cache, CACHE_KEYS } from './utils/cache';
import { User, Product, Order, OrderWithItems } from './types';

export const bot = new Telegraf(process.env.BOT_TOKEN!);
const db = new DatabaseService();

// Session storage (in production, use Redis or similar)
const sessions = new Map<number, any>();

function getSession(userId: number) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {});
  }
  return sessions.get(userId);
}

// Utility functions
function formatPrice(price: number): string {
  return `${price.toFixed(0)} ₽`;
}

const deliveryCache = new Map<number, any>();

function formatOrder(order: OrderWithItems): string {
  let text = `📋 Заказ #${order.id}\n`;
  text += ` \n`; // Пробел вместо даты
  
  // Use cached delivery details if DB fields are missing (schema cache issue)
  const cachedDetails = deliveryCache.get(order.id);
  const delivery_side = order.delivery_side || cachedDetails?.delivery_side;
  const sector = order.sector || cachedDetails?.sector;
  const seat_row = order.seat_row || cachedDetails?.seat_row;
  const seat_number = order.seat_number || cachedDetails?.seat_number;

  if (order.pickup_location === 'delivery') {
    text += `📍 Доставка: ${delivery_side === 'left' ? 'Левая' : 'Правая'} сторона, Сектор ${sector}, Ряд ${seat_row}, Место ${seat_number}\n`;
  } else {
    text += `📍 ${order.pickup_location === 'left_buffer' ? 'Левый буфет' : 'Правый буфет'}\n`;
  }
  
  text += `📊 Статус: ${getStatusText(order.status)}\n\n`;
  
  text += `🛒 Состав заказа:\n`;
  for (const item of order.order_items) {
    text += `• ${item.product.name} x${item.quantity} = ${formatPrice(item.quantity * item.price_at_time)}\n`;
  }
  
  text += `\n💰 Итого: ${formatPrice(order.total_amount)}\n`;
  text += `📅 ${new Date(order.created_at).toLocaleString('ru')}`; // Время в самый низ
  
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

    let sellerRole: string;
    if (order.pickup_location === 'delivery') {
      sellerRole = 'delivery';
    } else {
      sellerRole = order.pickup_location === 'left_buffer' ? 'seller_left' : 'seller_right';
    }
    
    // In a real application, you would maintain a list of seller chat IDs
    // For now, we'll log the notification
    console.log(`Notification for ${sellerRole}: New order #${order.id}`);
    
    // Here you would send the notification to sellers
    // const sellerChatIds = await getSellersForLocation(order.pickup_location);
    // for (const chatId of sellerChatIds) {
    //   await bot.telegram.sendMessage(chatId, formatOrder(order), {
    //     reply_markup: Markup.inlineKeyboard([
    //       Markup.button.callback('👨‍🍳 Взять в работу', `take_order_${order.id}`)
    //     ]).reply_markup
    //   });
    // }
  } catch (error) {
    console.error('Error notifying sellers:', error);
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
  await showCategoriesMenu(ctx);
});

async function showCategoriesMenu(ctx: Context) {
  const keyboard = Markup.keyboard([
    ['🍿 Попкорн', '🥤 Напитки'],
    ['🍕 Еда', '🍬 Сладкое'],
    ['🍦 Мороженое', '🧸 Игрушки'],
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

bot.hears('🍕 Еда', async (ctx) => {
  await showProductsInCategory(ctx, 'food');
});

bot.hears('🍬 Сладкое', async (ctx) => {
  await showProductsInCategory(ctx, 'sweets');
});

bot.hears('🍦 Мороженое', async (ctx) => {
  await showProductsInCategory(ctx, 'ice_cream');
});

bot.hears('🧸 Игрушки', async (ctx) => {
  await showProductsInCategory(ctx, 'toys');
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

// Handle product selection - step 1: choose quantity
bot.action(/add_product_(\d+)/, async (ctx) => {
  const productId = parseInt(ctx.match[1]);
  
  try {
    const products = await getCachedProducts();
    const product = products.find(p => p.id === productId);
    
    if (!product) {
      await ctx.answerCbQuery('Товар не найден');
      return;
    }
    
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('1️⃣', `confirm_qty_${productId}_1`),
        Markup.button.callback('2️⃣', `confirm_qty_${productId}_2`),
        Markup.button.callback('3️⃣', `confirm_qty_${productId}_3`)
      ],
      [
        Markup.button.callback('4️⃣', `confirm_qty_${productId}_4`),
        Markup.button.callback('5️⃣', `confirm_qty_${productId}_5`)
      ],
      [Markup.button.callback('⬅️ Отмена', 'continue_shopping')]
    ]);
    
    await ctx.editMessageText(
      `Вы выбрали: *${product.name}*\nУкажите количество:`,
      { parse_mode: 'Markdown', reply_markup: keyboard.reply_markup }
    );
  } catch (error) {
    console.error('Error in quantity selection:', error);
    await ctx.answerCbQuery('Произошла ошибка');
  }
});

// Handle quantity confirmation - step 2: add to cart and show summary
bot.action(/confirm_qty_(\d+)_(\d+)/, async (ctx) => {
  const productId = parseInt(ctx.match[1]);
  const quantity = parseInt(ctx.match[2]);
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
      await ctx.answerCbQuery('Ошибка корзины');
      return;
    }
    
    const success = await db.addItemToOrder(cartOrder.id, productId, quantity, product.price);
    
    if (success) {
      const orderWithItems = await db.getOrderWithItems(cartOrder.id);
      
      let cartSummary = '';
      if (orderWithItems) {
        cartSummary = '\n\n🛒 *Текущий состав корзины:*\n';
        for (const item of orderWithItems.order_items) {
          cartSummary += `• ${item.product.name} x${item.quantity} = ${formatPrice(item.quantity * item.price_at_time)}\n`;
        }
        cartSummary += `💰 *Итого:* ${formatPrice(orderWithItems.total_amount)}`;
      }

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🛒 Перейти в корзину', 'show_cart')],
        [Markup.button.callback('🍿 Продолжить покупки', 'continue_shopping')]
      ]);
      
      await ctx.editMessageText(
        `✅ *Добавлено:* ${product.name} (x${quantity})${cartSummary}\n\nЧто дальше?`,
        { parse_mode: 'Markdown', reply_markup: keyboard.reply_markup }
      );
    } else {
      await ctx.answerCbQuery('Ошибка добавления');
    }
  } catch (error) {
    console.error('Error confirming quantity:', error);
    await ctx.answerCbQuery('Произошла ошибка');
  }
});

// Cart handlers
bot.hears(/🛒 Корзина/, async (ctx) => {
  await showCart(ctx);
});

bot.action('show_cart', async (ctx) => {
  await ctx.answerCbQuery();
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
    [Markup.button.callback('✏️ Редактировать корзину', 'edit_cart')],
    [Markup.button.callback('🗑 Очистить корзину', 'clear_cart')],
    [Markup.button.callback('🍿 Продолжить покупки', 'continue_shopping')]
  ]);
  
  await ctx.reply(text, keyboard);
}

// Edit Cart Handlers
bot.action('edit_cart', async (ctx) => {
  const user = ctx.state.user as User;
  const cartOrder = await db.getOrCreateCartOrder(user.user_id);
  
  if (!cartOrder) return ctx.answerCbQuery('Ошибка корзины');
  
  const orderWithItems = await db.getOrderWithItems(cartOrder.id);
  if (!orderWithItems || orderWithItems.order_items.length === 0) {
    return ctx.editMessageText('Корзина пуста', Markup.inlineKeyboard([
      [Markup.button.callback('🍿 К покупкам', 'continue_shopping')]
    ]));
  }

  const buttons = orderWithItems.order_items.map(item => [
    Markup.button.callback(item.product.name, `edit_item_${item.product_id}`)
  ]);
  
  buttons.push([Markup.button.callback('✅ Готово', 'show_cart')]);

  await ctx.editMessageText('Выберите товар для редактирования:', Markup.inlineKeyboard(buttons));
});

bot.action(/edit_item_(\d+)/, async (ctx) => {
  const productId = parseInt(ctx.match[1]);
  const user = ctx.state.user as User;
  const cartOrder = await db.getOrCreateCartOrder(user.user_id);
  
  if (!cartOrder) return ctx.answerCbQuery('Ошибка корзины');
  
  const orderWithItems = await db.getOrderWithItems(cartOrder.id);
  const item = orderWithItems?.order_items.find(i => i.product_id === productId);
  
  if (!item) return ctx.answerCbQuery('Товар не найден');

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('1️⃣', `update_item_qty_${productId}_1`),
      Markup.button.callback('2️⃣', `update_item_qty_${productId}_2`),
      Markup.button.callback('3️⃣', `update_item_qty_${productId}_3`)
    ],
    [
      Markup.button.callback('4️⃣', `update_item_qty_${productId}_4`),
      Markup.button.callback('5️⃣', `update_item_qty_${productId}_5`)
    ],
    [Markup.button.callback('🗑 Удалить позицию', `remove_item_${productId}`)],
    [Markup.button.callback('⬅️ Назад к списку', 'edit_cart')]
  ]);

  await ctx.editMessageText(
    `Редактирование: *${item.product.name}*\nТекущее количество: ${item.quantity}`,
    { parse_mode: 'Markdown', reply_markup: keyboard.reply_markup }
  );
});

bot.action(/update_item_qty_(\d+)_(\d+)/, async (ctx) => {
  const productId = parseInt(ctx.match[1]);
  const quantity = parseInt(ctx.match[2]);
  const user = ctx.state.user as User;
  
  const cartOrder = await db.getOrCreateCartOrder(user.user_id);
  if (!cartOrder) return ctx.answerCbQuery('Ошибка корзины');

  const orderWithItems = await db.getOrderWithItems(cartOrder.id);
  const currentItem = orderWithItems?.order_items.find(i => i.product_id === productId);
  
  if (currentItem && currentItem.quantity === quantity) {
    return ctx.answerCbQuery(`Количество уже ${quantity}`);
  }

  const success = await db.updateItemQuantity(cartOrder.id, productId, quantity);
  if (success) {
    await ctx.answerCbQuery(`Количество обновлено: ${quantity}`);
    
    return ctx.editMessageText(
      `Редактирование: *${currentItem?.product.name}*\nТекущее количество: ${quantity}`,
      {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [
            Markup.button.callback('1️⃣', `update_item_qty_${productId}_1`),
            Markup.button.callback('2️⃣', `update_item_qty_${productId}_2`),
            Markup.button.callback('3️⃣', `update_item_qty_${productId}_3`)
          ],
          [
            Markup.button.callback('4️⃣', `update_item_qty_${productId}_4`),
            Markup.button.callback('5️⃣', `update_item_qty_${productId}_5`)
          ],
          [Markup.button.callback('🗑 Удалить позицию', `remove_item_${productId}`)],
          [Markup.button.callback('⬅️ Назад к списку', 'edit_cart')]
        ]).reply_markup
      }
    );
  }
  await ctx.answerCbQuery('Ошибка обновления');
});

bot.action(/remove_item_(\d+)/, async (ctx) => {
  const productId = parseInt(ctx.match[1]);
  const user = ctx.state.user as User;
  
  const cartOrder = await db.getOrCreateCartOrder(user.user_id);
  if (!cartOrder) return ctx.answerCbQuery('Ошибка корзины');

  const success = await db.removeItemFromOrder(cartOrder.id, productId);
  if (success) {
    await ctx.answerCbQuery('Товар удален');
    // Go back to the edit list
    const orderWithItems = await db.getOrderWithItems(cartOrder.id);
    if (!orderWithItems || orderWithItems.order_items.length === 0) {
      return ctx.editMessageText('Корзина пуста', Markup.inlineKeyboard([
        [Markup.button.callback('🍿 К покупкам', 'continue_shopping')]
      ]));
    }
    const buttons = orderWithItems.order_items.map(item => [
      Markup.button.callback(item.product.name, `edit_item_${item.product_id}`)
    ]);
    buttons.push([Markup.button.callback('✅ Готово', 'show_cart')]);
    return ctx.editMessageText('Выберите товар для редактирования:', Markup.inlineKeyboard(buttons));
  }
  await ctx.answerCbQuery('Ошибка удаления');
});

// Checkout process
bot.action('checkout_order', async (ctx) => {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📍 Левый буфет', 'pickup_left_buffer')],
    [Markup.button.callback('📍 Правый буфет', 'pickup_right_buffer')],
    [Markup.button.callback('🚚 Доставка до места', 'pickup_delivery')],
    [Markup.button.callback('⬅️ Назад', 'show_cart')]
  ]);
  
  await ctx.editMessageText(
    'Выберите место получения заказа:',
    keyboard
  );
});

bot.action('pickup_delivery', async (ctx) => {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('⬅️ Левая сторона', 'delivery_side_left')],
    [Markup.button.callback('➡️ Правая сторона', 'delivery_side_right')]
  ]);
  await ctx.editMessageText('Выберите сторону зала:', keyboard);
});

bot.action(/delivery_side_(left|right)/, async (ctx) => {
  const side = ctx.match[1];
  const session = getSession(ctx.from!.id);
  session.delivery_side = side;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('1', 'delivery_sector_1'), Markup.button.callback('2', 'delivery_sector_2')],
    [Markup.button.callback('3', 'delivery_sector_3'), Markup.button.callback('4', 'delivery_sector_4')]
  ]);
  await ctx.editMessageText('Выберите сектор:', keyboard);
});

bot.action(/delivery_sector_(\d)/, async (ctx) => {
  const sector = parseInt(ctx.match[1]);
  const session = getSession(ctx.from!.id);
  session.delivery_sector = sector;
  session.waiting_for_row = true;
  await ctx.editMessageText('Введите номер ряда:');
});

bot.on('text', async (ctx, next) => {
  const session = getSession(ctx.from!.id);
  
  if (session.waiting_for_row) {
    session.delivery_row = ctx.message.text;
    session.waiting_for_row = false;
    session.waiting_for_seat = true;
    await ctx.reply('Введите номер места:');
    return;
  }
  
  if (session.waiting_for_seat) {
    session.delivery_seat = ctx.message.text;
    session.waiting_for_seat = false;
    
    await processCheckout(ctx, 'delivery', {
      delivery_side: session.delivery_side,
      sector: session.delivery_sector,
      seat_row: session.delivery_row,
      seat_number: session.delivery_seat
    });
    return;
  }
  
  return next();
});

bot.action('pickup_left_buffer', async (ctx) => {
  await processCheckout(ctx, 'left_buffer');
});

bot.action('pickup_right_buffer', async (ctx) => {
  await processCheckout(ctx, 'right_buffer');
});

async function processCheckout(ctx: Context, pickupLocation: 'left_buffer' | 'right_buffer' | 'delivery', deliveryDetails?: any) {
  const user = ctx.state.user as User;
  
  try {
    const cartOrder = await db.getOrCreateCartOrder(user.user_id);
    if (!cartOrder) {
      if (ctx.callbackQuery) await ctx.answerCbQuery('Ошибка получения корзины');
      else await ctx.reply('Ошибка получения корзины');
      return;
    }
    
    const orderWithItems = await db.getOrderWithItems(cartOrder.id);
    if (!orderWithItems || orderWithItems.order_items.length === 0) {
      if (ctx.callbackQuery) await ctx.answerCbQuery('Корзина пуста');
      else await ctx.reply('Корзина пуста');
      return;
    }
    
    const success = await db.updateOrderStatus(cartOrder.id, 'pending', pickupLocation, deliveryDetails);
    
    if (success) {
      if (pickupLocation === 'delivery') {
        deliveryCache.set(cartOrder.id, deliveryDetails);
      }
      const updatedOrder = await db.getOrderWithItems(cartOrder.id);
      if (updatedOrder) {
        await notifySellers(updatedOrder);
      }
      
      let locationText = '';
      if (pickupLocation === 'delivery') {
        locationText = `Доставка (${deliveryDetails.delivery_side === 'left' ? 'Левая' : 'Правая'} сторона, Сектор ${deliveryDetails.sector}, Ряд ${deliveryDetails.seat_row}, Место ${deliveryDetails.seat_number})`;
      } else {
        locationText = pickupLocation === 'left_buffer' ? 'Левый буфет' : 'Правый буфет';
      }

      const message = `✅ Заказ #${cartOrder.id} успешно оформлен!\n\n` +
        `📍 Место получения: ${locationText}\n` +
        `💰 Сумма: ${formatPrice(orderWithItems.total_amount)}\n\n` +
        `Ожидайте уведомления о готовности заказа.`;

      if (ctx.callbackQuery) {
        await ctx.editMessageText(message);
      } else {
        await ctx.reply(message);
      }
      
      await showCustomerMainMenu(ctx);
    } else {
      if (ctx.callbackQuery) await ctx.answerCbQuery('Ошибка оформления заказа');
      else await ctx.reply('Ошибка оформления заказа');
    }
  } catch (error) {
    console.error('Error processing checkout:', error);
    if (ctx.callbackQuery) await ctx.answerCbQuery('Произошла ошибка');
    else await ctx.reply('Произошла ошибка');
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
    if (order.customer_id !== user.user_id && !['seller_left', 'seller_right'].includes(user.role)) {
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
    // Try to cancel from 'pending' status first (most common for new orders)
    let success = await db.atomicStatusUpdate(orderId, 'pending', 'cancelled');
    
    // If not successful (maybe it's already in 'preparing'), try 'preparing'
    if (!success) {
      success = await db.atomicStatusUpdate(orderId, 'preparing', 'cancelled');
    }
    
    if (success) {
      await ctx.editMessageText(
        `✅ Заказ #${orderId} успешно отменен.`
      );
      
      // Notify relevant parties about cancellation
      const order = await db.getOrderWithItems(orderId);
      if (order && user.role === 'customer') {
        console.log(`Customer cancelled order #${orderId}`);
      } else if (order && ['seller_left', 'seller_right'].includes(user.role)) {
        console.log(`Seller ${user.role} cancelled order #${orderId}`);
        // TODO: Notify customer about seller cancellation
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

bot.hears('📥 Новые заказы', async (ctx) => {
  const user = ctx.state.user as User;
  if (user.role === 'customer') return;
  
  let orders: OrderWithItems[];
  if (user.role === 'delivery') {
    orders = await db.getPendingDeliveryOrders();
  } else {
    orders = await db.getPendingOrdersForSeller(user.role as any);
  }
  
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
  
  let orders: OrderWithItems[];
  if (user.role === 'delivery') {
    orders = await db.getActiveDeliveryOrders();
  } else {
    orders = await db.getActiveOrdersForSeller(user.role as any);
  }
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
  
  let orders: OrderWithItems[];
  if (user.role === 'delivery') {
    orders = await db.getActiveDeliveryOrders();
  } else {
    orders = await db.getActiveOrdersForSeller(user.role as any);
  }
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

// Seller actions
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
          let readyMessage = `✅ Ваш заказ #${orderId} готов! `;
          if (order.pickup_location === 'delivery') {
            readyMessage = `✅ Ваш заказ #${orderId} готов и скоро будет доставлен к вашему месту! 🍿🚚`;
          } else {
            readyMessage += `Пожалуйста, заберите его в ${order.pickup_location === 'left_buffer' ? 'левом буфете' : 'правом буфете'}.`;
          }
          await bot.telegram.sendMessage(order.customer_id, readyMessage);
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
  const user = ctx.state.user as User;
  
  try {
    const cartOrder = await db.getOrCreateCartOrder(user.user_id);
    if (!cartOrder) {
      await ctx.answerCbQuery('Ошибка получения корзины');
      return;
    }
    
    const success = await db.clearCart(cartOrder.id);
    
    if (success) {
      await ctx.answerCbQuery('🗑 Корзина очищена');
      await ctx.editMessageText('Ваша корзина очищена. Добавьте товары для оформления заказа.', Markup.inlineKeyboard([
        [Markup.button.callback('🍿 Перейти к покупкам', 'continue_shopping')]
      ]));
    } else {
      await ctx.answerCbQuery('Ошибка при очистке');
    }
  } catch (error) {
    console.error('Error clearing cart:', error);
    await ctx.answerCbQuery('Произошла ошибка');
  }
});

// Back navigation
bot.hears('⬅️ Назад', async (ctx) => {
  const user = ctx.state.user as User;
  if (user.role === 'customer') {
    await showCustomerMainMenu(ctx);
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