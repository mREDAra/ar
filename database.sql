-- تنظيف القاعدة القديمة لضمان هيكل سليم (تحذير: هذا سيحذف كل شيء)
-- يجب تنفيذ هذا الكود لاحقاً فقط عندما تكون مستعداً لتفريغ البيانات القديمة
DROP TABLE IF EXISTS public.transaction_items CASCADE;
DROP TABLE IF EXISTS public.transactions CASCADE;
DROP TABLE IF EXISTS public.inventory_items CASCADE;

-- 1. جدول المخزون (الأصناف)
CREATE TABLE public.inventory_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    stock_quantity NUMERIC DEFAULT 0 NOT NULL,
    average_cost_usd NUMERIC DEFAULT 0.0 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- إدراج الأصناف كما ذكرتها كتهيئة مبدئية
INSERT INTO public.inventory_items (name) VALUES 
('Vip'), 
('Premium'), 
('Prestige'), 
('Patik'), 
('Tenis'), 
('Pencereli patik'), 
('Bambo patik'), 
('Atlet'), 
('Uzun bambo'), 
('Havlu');

-- 2. جدول الحركات المالية والفواتير
CREATE TABLE public.transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('deposit', 'purchase', 'expense', 'withdrawal', 'sale')),
    total_amount NUMERIC NOT NULL CHECK (total_amount >= 0),
    currency TEXT NOT NULL CHECK (currency IN ('USD', 'TRY')),
    exchange_rate_used NUMERIC, -- سعر الصرف الذي كان معتمداً لحظة الحركة
    description TEXT NOT NULL,
    person TEXT
);

-- 3. جدول تفاصيل الفواتير (لربط الشراء والبيع بالبضاعة)
CREATE TABLE public.transaction_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.inventory_items(id),
    quantity NUMERIC NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC NOT NULL CHECK (unit_price >= 0), -- السعر بالعملة المختارة في الفاتورة الأساسية
    unit_cost_usd_at_time NUMERIC -- تكلفة القطعة وقت البيع (لغايات حساب الربح لاحقاً)
);

-- تعطيل مؤقت لـ RLS لسهولة الإدخال والاستخدام
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow ALL on inventory" ON public.inventory_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow ALL on transactions" ON public.transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow ALL on items" ON public.transaction_items FOR ALL USING (true) WITH CHECK (true);
