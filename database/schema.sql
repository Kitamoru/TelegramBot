-- Enable Row Level Security
ALTER TABLE IF EXISTS profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS products ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS order_items ENABLE ROW LEVEL SECURITY;

-- Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
    user_id BIGINT PRIMARY KEY,
    username TEXT,
    full_name TEXT,
    role TEXT DEFAULT 'customer' CHECK (role IN ('customer', 'seller_left', 'seller_right')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create products table
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('popcorn', 'drinks', 'cotton_candy')),
    price DECIMAL(10,2) NOT NULL,
    is_available BOOLEAN DEFAULT TRUE
);

-- Create orders table
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    customer_id BIGINT REFERENCES profiles(user_id),
    status TEXT DEFAULT 'cart' CHECK (status IN ('cart', 'pending', 'preparing', 'ready_for_pickup', 'completed', 'cancelled')),
    pickup_location TEXT CHECK (pickup_location IN ('left_buffer', 'right_buffer')),
    total_amount DECIMAL(10,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create order_items table
CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id INT REFERENCES orders(id) ON DELETE CASCADE,
    product_id INT REFERENCES products(id),
    quantity INT NOT NULL DEFAULT 1,
    price_at_time DECIMAL(10,2) NOT NULL
);

-- Create trigger for updating updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
CREATE TRIGGER update_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies for profiles
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile" ON profiles
    FOR SELECT USING (auth.uid()::bigint = user_id);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (auth.uid()::bigint = user_id);

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile" ON profiles
    FOR INSERT WITH CHECK (auth.uid()::bigint = user_id);

-- RLS Policies for products
DROP POLICY IF EXISTS "Anyone can view products" ON products;
CREATE POLICY "Anyone can view products" ON products
    FOR SELECT USING (true);

-- RLS Policies for orders
DROP POLICY IF EXISTS "Customers can manage their orders" ON orders;
CREATE POLICY "Customers can manage their orders" ON orders
    USING (
        customer_id = auth.uid()::bigint OR
        (pickup_location = 'left_buffer' AND EXISTS (
            SELECT 1 FROM profiles WHERE user_id = auth.uid()::bigint AND role = 'seller_left'
        )) OR
        (pickup_location = 'right_buffer' AND EXISTS (
            SELECT 1 FROM profiles WHERE user_id = auth.uid()::bigint AND role = 'seller_right'
        ))
    );

-- RLS Policies for order_items
DROP POLICY IF EXISTS "Order items inherit order policies" ON order_items;
CREATE POLICY "Order items inherit order policies" ON order_items
    USING (
        EXISTS (
            SELECT 1 FROM orders 
            WHERE orders.id = order_items.order_id 
            AND (
                orders.customer_id = auth.uid()::bigint OR
                (orders.pickup_location = 'left_buffer' AND EXISTS (
                    SELECT 1 FROM profiles WHERE user_id = auth.uid()::bigint AND role = 'seller_left'
                )) OR
                (orders.pickup_location = 'right_buffer' AND EXISTS (
                    SELECT 1 FROM profiles WHERE user_id = auth.uid()::bigint AND role = 'seller_right'
                ))
            )
        )
    );

-- Function for atomic status updates to prevent race conditions
CREATE OR REPLACE FUNCTION atomic_status_update(
    order_id INTEGER,
    expected_status TEXT,
    new_status TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
    updated_rows INTEGER;
BEGIN
    UPDATE orders 
    SET status = new_status, updated_at = NOW()
    WHERE id = order_id AND status = expected_status;
    
    GET DIAGNOSTICS updated_rows = ROW_COUNT;
    
    RETURN updated_rows > 0;
END;
$$ LANGUAGE plpgsql;

-- Insert sample products
INSERT INTO products (name, category, price, is_available) VALUES
    ('Сладкий попкорн', 'popcorn', 150.00, true),
    ('Соленый попкорн', 'popcorn', 150.00, true),
    ('Карамельный попкорн', 'popcorn', 200.00, true),
    ('Кока-кола', 'drinks', 100.00, true),
    ('Спрайт', 'drinks', 100.00, true),
    ('Фанта', 'drinks', 100.00, true),
    ('Вода', 'drinks', 50.00, true),
    ('Сок яблочный', 'drinks', 120.00, true),
    ('Розовая вата', 'cotton_candy', 180.00, true),
    ('Голубая вата', 'cotton_candy', 180.00, true),
    ('Белая вата', 'cotton_candy', 180.00, true)
ON CONFLICT (id) DO NOTHING;