import { useState, useEffect, useMemo } from 'react';
import { supabase } from './lib/supabase';
import { Toaster, toast } from 'react-hot-toast';
import { 
  ArrowDownRight, ArrowUpRight, Plus, RefreshCw, 
  Wallet, LayoutGrid, Trash2, Edit, Search, X, 
  ArrowRightLeft, Globe, Gem, Package, ShoppingCart, Printer
} from 'lucide-react';
import { format } from 'date-fns';

function App() {
  const [transactions, setTransactions] = useState([]);
  const [products, setProducts] = useState([]);
  
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  
  // Exchange API State
  const [exchangeRate, setExchangeRate] = useState(null);
  const [loadingRate, setLoadingRate] = useState(true);

  // Tabs / Modes
  const [entryMode, setEntryMode] = useState('single'); // 'single' | 'exchange'

  // Filter & Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterCurrency, setFilterCurrency] = useState('all');

  // Balances
  const [balances, setBalances] = useState({ USD: 0, TRY: 0 });

  // Form State - Single Transaction & Invoice
  const [form, setForm] = useState({
    type: 'deposit',
    amount: '', // Used for deposit/expense/withdrawal
    currency: 'USD',
    description: '',
    person: ''
  });

  // Cart State (for Sale and Purchase)
  const [cart, setCart] = useState([]);
  const [cartItem, setCartItem] = useState({ product_id: '', quantity: '', unit_price: '' });

  // Form State - Exchange
  const [exchangeForm, setExchangeForm] = useState({
    usdAmount: '',
    estimatedTry: ''
  });

  // Print Invoice State
  const [printingInvoice, setPrintingInvoice] = useState(null);

  const isCartMode = form.type === 'purchase' || form.type === 'sale';

  const fetchExchangeRate = async () => {
    try {
      setLoadingRate(true);
      const res = await fetch('https://v6.exchangerate-api.com/v6/8362e8fca780760c75dc108e/latest/USD');
      const data = await res.json();
      if (data && data.result === 'success') {
        const rawRate = data.conversion_rates.TRY;
        // Apply 1% margin reduction
        const marginedRate = rawRate * 0.99;
        setExchangeRate(marginedRate);
      }
    } catch {
      toast.error('حدث خطأ في الاتصال بخدمة أسعار الصرف');
    } finally {
      setLoadingRate(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    // Fetch Inventory
    const resProducts = await supabase.from('inventory_items').select('*').order('name');
    if (resProducts.data) setProducts(resProducts.data);

    // Fetch Transactions
    const resTrans = await supabase.from('transactions').select('*').order('created_at', { ascending: false });
    if (resTrans.error) {
      toast.error('حدث خطأ أثناء جلب الحركات');
    } else {
      setTransactions(resTrans.data);
      calculateBalances(resTrans.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchExchangeRate();
    fetchData();
  }, []);

  const calculateBalances = (data) => {
    let usd = 0;
    let tr = 0;

    data.forEach(t => {
      const amount = Number(t.total_amount);
      const isPositive = t.type === 'deposit' || t.type === 'sale';
      
      if (t.currency === 'USD') {
        usd += isPositive ? amount : -amount;
      } else if (t.currency === 'TRY') {
        tr += isPositive ? amount : -amount;
      }
    });

    setBalances({ USD: usd, TRY: tr });
  };

  const unifiedNetWorth = useMemo(() => {
    if (!exchangeRate) return null;
    const tryInUsd = balances.TRY / exchangeRate;
    return balances.USD + tryInUsd;
  }, [balances, exchangeRate]);

  // Inventory Worth
  const inventoryWorthUsd = useMemo(() => {
    return products.reduce((acc, p) => acc + (p.stock_quantity * p.average_cost_usd), 0);
  }, [products]);

  const handleInputChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleCartItemChange = (e) => {
    setCartItem({ ...cartItem, [e.target.name]: e.target.value });
  };

  const addCartItem = () => {
    if (!cartItem.product_id || !cartItem.quantity || !cartItem.unit_price) {
      toast.error('يرجى ملء تفاصيل الصنف بالكامل');
      return;
    }
    const prd = products.find(p => p.id === cartItem.product_id);
    
    // Check Stock if Sale
    if (form.type === 'sale') {
      const currentCartQty = cart.filter(c => c.product_id === prd.id).reduce((sum, c) => sum + Number(c.quantity), 0);
      if (Number(cartItem.quantity) + currentCartQty > prd.stock_quantity) {
        toast.error(`الكمية المطلوبة للبيع غير متوفرة في المستودع! المتاح: ${prd.stock_quantity}`);
        return;
      }
    }

    setCart([...cart, { ...cartItem, prd_name: prd.name }]);
    setCartItem({ product_id: '', quantity: '', unit_price: '' });
  };

  const removeCartItem = (index) => {
    setCart(cart.filter((_, i) => i !== index));
  };

  const cartTotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.unit_price)), 0);
  }, [cart]);

  const clearForm = () => {
    setForm({ ...form, amount: '', description: '', person: '' });
    setCart([]);
    setCartItem({ product_id: '', quantity: '', unit_price: '' });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Determine the total amount
    const totalAmount = isCartMode ? cartTotal : Number(form.amount);

    if (totalAmount <= 0) {
      toast.error('خطأ: لم يتم تحديد مبلغ صحيح للصندوق');
      return;
    }
    if (!form.description) {
      toast.error('الرجاء كتابة البيان / الوصف');
      return;
    }

    // STRICT BALANCE CHECK constraint from User
    if (form.type === 'purchase' || form.type === 'expense' || form.type === 'withdrawal') {
      if (totalAmount > balances[form.currency]) {
        toast.error(`رصيدك في الصندوق من العملة ${form.currency} غير كافٍ! يرجى القيام بعملية تصريف أولاً.`);
        return;
      }
    }

    if (isCartMode && cart.length === 0) {
      toast.error('الرجاء إضافة أصناف للفاتورة');
      return;
    }

    setSubmitting(true);
    
    // 1. Insert Transaction Master
    const { data: trxResult, error: trxErr } = await supabase.from('transactions').insert([{
      type: form.type,
      total_amount: totalAmount,
      currency: form.currency,
      exchange_rate_used: exchangeRate,
      description: form.description,
      person: form.person || null
    }]).select();

    if (trxErr) {
      toast.error('حدث خطأ أثناء إضافة الحركة');
      setSubmitting(false);
      return;
    }

    const transactionId = trxResult[0].id;

    // 2. If Cart Mode, Insert Items and Update Stock
    if (isCartMode) {
      const itemsToInsert = cart.map(item => ({
        transaction_id: transactionId,
        product_id: item.product_id,
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        unit_cost_usd_at_time: products.find(p=>p.id === item.product_id).average_cost_usd
      }));

      await supabase.from('transaction_items').insert(itemsToInsert);

      // Update Inventory
      for (const item of cart) {
        const dbProduct = products.find(p => p.id === item.product_id);
        const itemQty = Number(item.quantity);
        const itemPriceRaw = Number(item.unit_price);
        
        let newQty = Number(dbProduct.stock_quantity);
        let newAvgCost = Number(dbProduct.average_cost_usd);

        if (form.type === 'purchase') {
          // Calculate cost in USD
          const costInUsd = (form.currency === 'USD') ? itemPriceRaw : (itemPriceRaw / exchangeRate);
          const totalOldValue = newQty * newAvgCost;
          const totalNewValue = itemQty * costInUsd;
          
          newQty += itemQty;
          newAvgCost = (totalOldValue + totalNewValue) / newQty;
          
        } else if (form.type === 'sale') {
          newQty -= itemQty;
          // Avg cost remains the same on sales
        }

        await supabase.from('inventory_items').update({
          stock_quantity: newQty,
          average_cost_usd: newAvgCost
        }).eq('id', dbProduct.id);
      }
    }

    toast.success('تمت الحركة بنجاح');
    clearForm();
    await fetchData(); // Refresh all
    setSubmitting(false);
  };

  const handleExchangeInputChange = (e) => {
    const { name, value } = e.target;
    if (name === 'usdAmount') {
      const estimated = exchangeRate ? (Number(value) * exchangeRate).toFixed(2) : '';
      setExchangeForm({ usdAmount: value, estimatedTry: estimated });
    } else {
      setExchangeForm({ ...exchangeForm, [name]: value });
    }
  };

  const handleExchangeSubmit = async (e) => {
    e.preventDefault();
    if (!exchangeForm.usdAmount || !exchangeForm.estimatedTry) {
      toast.error('الرجاء إدخال المبلاغ للتحويل');
      return;
    }

    // STRICT BALANCE CHECK validation for Exchange
    if (Number(exchangeForm.usdAmount) > balances.USD) {
       toast.error(`رصيدك من الدولار غير كافٍ لإتمام عملية التصريف! المتوفر: ${balances.USD}$`);
       return;
    }

    if (!window.confirm(`تأكيد عملية تصريف ${exchangeForm.usdAmount}$ ؟`)) return;
    setSubmitting(true);
    
    const { error } = await supabase.from('transactions').insert([
      {
        type: 'withdrawal', total_amount: Number(exchangeForm.usdAmount), currency: 'USD',
        description: `صرافة تحويل (سعر الصرف: ${exchangeRate?.toFixed(4)})`, person: 'System'
      },
      {
        type: 'deposit', total_amount: Number(exchangeForm.estimatedTry), currency: 'TRY',
        description: `صرافة استلام (بدل ${exchangeForm.usdAmount}$)`, person: 'System', exchange_rate_used: exchangeRate
      }
    ]);

    if (error) toast.error('حدث خطأ أثناء الصرافة');
    else {
      toast.success('تمت الصرافة بنجاح');
      setExchangeForm({ usdAmount: '', estimatedTry: '' });
      fetchData();
    }
    setSubmitting(false);
  };

  const handleDeleteTransaction = async (t) => {
    const isInventoryTx = t.type === 'purchase' || t.type === 'sale';
    if (!window.confirm(isInventoryTx 
      ? 'هل أنت متأكد من حذف هذه الفاتورة المرتجعة؟ سيتم التراجع عن أثرها المالي وإرجاع كمياتها للمستودع أوتوماتيكياً.' 
      : 'هل أنت متأكد من حذف هذه الحركة؟ سيتم التراجع عن أثرها المالي.')) return;
    
    setSubmitting(true);

    if (isInventoryTx) {
      // 1. Fetch items before deletion so we know what to revert
      const { data: items } = await supabase.from('transaction_items').select('*').eq('transaction_id', t.id);
      
      // 2. Fetch fresh inventory state
      const { data: inventory } = await supabase.from('inventory_items').select('*');
      
      if (items && items.length > 0 && inventory) {
         for (const item of items) {
            const dbProduct = inventory.find(p => p.id === item.product_id);
            if (!dbProduct) continue;
            
            let newQty = Number(dbProduct.stock_quantity);
            let newAvgCost = Number(dbProduct.average_cost_usd);
            
            if (t.type === 'sale') {
               // Revert sale: Add goods back (average cost doesn't change when returning goods)
               newQty += Number(item.quantity);
            } else if (t.type === 'purchase') {
               // Revert purchase: Remove goods and adjust average cost backwards
               const itemQty = Number(item.quantity);
               // Because we didn't store unit_cost_usd_at_time for purchases specifically as a purchase footprint, 
               // we reconstruct it via exchange_rate_used of that master invoice:
               const costInUsd = (t.currency === 'USD') ? Number(item.unit_price) : (Number(item.unit_price) / t.exchange_rate_used);
               
               const totalCurrentVal = newQty * newAvgCost;
               const totalRemovedVal = itemQty * costInUsd;
               
               newQty -= itemQty;
               if (newQty > 0) {
                 newAvgCost = (totalCurrentVal - totalRemovedVal) / newQty;
                 if (newAvgCost < 0) newAvgCost = 0; // fallback math safety
               } else {
                 newAvgCost = 0; // if returning the only stock
               }
            }
            
            await supabase.from('inventory_items').update({
              stock_quantity: newQty,
              average_cost_usd: newAvgCost
            }).eq('id', item.product_id);
         }
      }
    }
    
    // 3. Delete the transaction (ON DELETE CASCADE handles removing items)
    const { error } = await supabase.from('transactions').delete().eq('id', t.id);
    if (error) {
      toast.error('حدث خطأ أثناء الحذف');
    } else {
      toast.success('تم الحذف التلقائي والإرجاع بنجاح');
      fetchData();
    }
    setSubmitting(false);
  };

  const handlePrintInvoice = async (t) => {
    setLoading(true);
    const { data: items } = await supabase.from('transaction_items').select('*, inventory_items(name)').eq('transaction_id', t.id);
    setLoading(false);
    if (items) {
      setPrintingInvoice({ transaction: t, items: items });
      // Minor delay to let modal render before invoking print dialog
      setTimeout(() => {
        window.print();
      }, 500);
    } else {
      toast.error('لا يمكن جلب تفاصيل الفاتورة للطباعة');
    }
  };

  const getTypeLabel = (type) => ({deposit:'إيداع',withdrawal:'سحب',purchase:'مشتريات',sale:'مبيعات',expense:'مصاريف'})[type] || type;
  const getTypeColorClass = (type) => (type === 'deposit' || type === 'sale') ? 'text-green' : 'text-red';
  const getTypeIcon = (type) => (type === 'deposit' || type === 'sale') ? <ArrowDownRight size={20} className="text-green" /> : <ArrowUpRight size={20} className="text-red" />;

  const filteredTransactions = transactions.filter(t => {
    return (t.description.toLowerCase().includes(searchQuery.toLowerCase()) || (t.person && t.person.toLowerCase().includes(searchQuery.toLowerCase())))
        && (filterType === 'all' || t.type === filterType)
        && (filterCurrency === 'all' || t.currency === filterCurrency);
  });

  return (
    <div className="container">
      <Toaster position="top-center" />
      
      <header className="flex items-center justify-between mb-6">
        <h1 className="flex items-center gap-2">
          <Wallet className="text-green" size={28} />
          <span>ادارة الأموال والمخزون</span>
        </h1>
        <button onClick={() => { fetchData(); fetchExchangeRate(); }} className="btn" style={{ padding: '0.5rem', background: 'var(--card-bg)' }}>
          <RefreshCw size={20} className={(loading || loadingRate) ? 'animate-spin' : ''} />
        </button>
      </header>

      {/* Unified Dashboards */}
      {unifiedNetWorth !== null && (
        <div className="card mb-4" style={{ background: 'linear-gradient(135deg, rgba(74,222,128,0.1), rgba(96,165,250,0.1))', border: '1px solid rgba(74,222,128,0.2)'}}>
          <div className="flex justify-between items-center" style={{ flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h3 className="flex items-center gap-2 text-primary mb-2" style={{ fontSize: '1rem' }}>
                <Gem size={18} /> السيولة المتوفرة بالدولار
              </h3>
              <h1 dir="ltr" style={{ fontSize: '2.5rem', margin: 0 }}>
                $ {unifiedNetWorth.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h1>
            </div>
            <div>
              <h3 className="flex items-center gap-2 text-blue mb-2" style={{ fontSize: '1rem' }}>
                <Package size={18} /> مجمد المخزون بالدولار
              </h3>
              <h1 dir="ltr" style={{ fontSize: '2rem', margin: 0, color: 'var(--sale)' }}>
                $ {inventoryWorthUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h1>
            </div>
          </div>
        </div>
      )}

      {/* Try/USD balances */}
      <div className="card mb-6" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px' }}>
          <p className="text-muted mb-2">رصيد الدولار ($)</p>
          <h2 style={{ fontSize: '2rem', color: balances.USD >= 0 ? 'var(--primary)' : 'var(--danger)' }} dir="ltr">{balances.USD.toLocaleString()} $</h2>
        </div>
        <div style={{ flex: '1 1 200px', borderRight: '1px solid var(--card-border)', paddingRight: '1rem' }}>
          <p className="text-muted mb-2">رصيد الليرة (TL)</p>
          <h2 style={{ fontSize: '2rem', color: balances.TRY >= 0 ? 'var(--primary)' : 'var(--danger)' }} dir="ltr">{balances.TRY.toLocaleString()} TL</h2>
        </div>
      </div>

      {/* Mode Switcher */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button onClick={() => { setEntryMode('single'); clearExchangeForm(); }} className="btn" style={{ flex: 1, background: entryMode === 'single' ? 'var(--card-bg)' : 'transparent', borderBottom: entryMode === 'single' ? '2px solid var(--primary)' : '2px solid transparent' }}>
          <Plus size={18} style={{ display: 'inline', marginInlineEnd: '6px' }} /> تسجيل حركة أو فاتورة
        </button>
        <button onClick={() => { setEntryMode('exchange'); clearForm(); }} className="btn" style={{ flex: 1, background: entryMode === 'exchange' ? 'var(--card-bg)' : 'transparent', borderBottom: entryMode === 'exchange' ? '2px solid var(--sale)' : '2px solid transparent' }}>
          <ArrowRightLeft size={18} style={{ display: 'inline', marginInlineEnd: '6px' }} /> تصريف عملات
        </button>
      </div>

      {/* Main Forms */}
      <div className="card mb-6" style={{ border: '1px solid var(--card-border)', borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
        
        {/* Single / Invoice Form */}
        {entryMode === 'single' && (
          <form onSubmit={handleSubmit}>
            <div className="flex gap-3" style={{ flexWrap: 'wrap', marginBottom: '1rem' }}>
              <div className="form-group" style={{ flex: '1 1 150px' }}>
                <label>نوع الحركة</label>
                <select name="type" className="form-control" value={form.type} onChange={handleInputChange}>
                  <option value="deposit">إيداع واردات</option>
                  <option value="sale">فاتورة مبيعات (بضاعة)</option>
                  <option value="purchase">فاتورة مشتريات (بضاعة)</option>
                  <option value="expense">دفع مصاريف</option>
                  <option value="withdrawal">سحب صندوق</option>
                </select>
              </div>

              <div className="form-group" style={{ flex: '1 1 100px' }}>
                <label>العملة</label>
                <select name="currency" className="form-control" value={form.currency} onChange={handleInputChange}>
                  <option value="USD">دولار ($)</option>
                  <option value="TRY">تركي (TL)</option>
                </select>
              </div>

              {/* Amount is only direct input if NOT cart mode */}
              {!isCartMode && (
                <div className="form-group" style={{ flex: '1 1 120px' }}>
                  <label>المبلغ الإجمالي</label>
                  <input type="number" name="amount" className="form-control" value={form.amount} onChange={handleInputChange} min="0.01" step="0.01" dir="ltr" />
                </div>
              )}
            </div>

            {/* Cart Section if Sale or Purchase */}
            {isCartMode && (
              <div style={{ background: 'var(--input-bg)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', border: '1px solid var(--input-border)' }}>
                <h4 className="mb-4 flex items-center gap-2"><ShoppingCart size={18} className="text-sale" /> سلة الأصناف ({form.type === 'sale' ? 'فاتورة بيع' : 'فاتورة شراء'})</h4>
                
                <div className="flex gap-2" style={{ flexWrap: 'wrap', marginBottom: '1rem' }}>
                  <div className="form-group" style={{ flex: '1 1 150px', margin: 0 }}>
                    <select name="product_id" className="form-control" value={cartItem.product_id} onChange={handleCartItemChange}>
                      <option value="">اختر الصنف...</option>
                      {products.map(p => (
                         <option key={p.id} value={p.id}>
                           {p.name} {form.type === 'sale' ? `(متاح: ${p.stock_quantity})` : ''}
                         </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group" style={{ flex: '1 1 80px', margin: 0 }}>
                    <input type="number" name="quantity" placeholder="الكمية" className="form-control" value={cartItem.quantity} onChange={handleCartItemChange} min="1" />
                  </div>
                  <div className="form-group" style={{ flex: '1 1 100px', margin: 0 }}>
                    <input type="number" name="unit_price" placeholder={`السعر الافرادي بـ ${form.currency}`} className="form-control" value={cartItem.unit_price} onChange={handleCartItemChange} step="0.01" />
                  </div>
                  <button type="button" onClick={addCartItem} className="btn" style={{ background: 'var(--primary)', color: '#000', padding: '0.6rem 1rem' }}>
                    إضافة +
                  </button>
                </div>

                {/* Cart Preview */}
                {cart.length > 0 && (
                  <table style={{ width: '100%', fontSize: '0.9rem', textAlign: 'right', borderCollapse: 'collapse' }}>
                    <thead style={{ borderBottom: '1px solid var(--card-border)' }}>
                      <tr><th>الصنف</th><th>الكمية</th><th>سعر الوحدة</th><th>مجموع</th><th></th></tr>
                    </thead>
                    <tbody>
                      {cart.map((c, i) => (
                        <tr key={i} style={{ borderBottom: '1px dashed rgba(255,255,255,0.05)' }}>
                          <td style={{ padding: '0.5rem 0' }}>{c.prd_name}</td>
                          <td>{c.quantity}</td>
                          <td>{c.unit_price} {form.currency}</td>
                          <td className="text-sale">{(c.quantity * c.unit_price).toFixed(2)} {form.currency}</td>
                          <td><button type="button" onClick={()=>removeCartItem(i)} style={{ color: 'var(--danger)', background: 'transparent' }}><X size={16} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan="3" style={{ padding: '1rem 0', fontWeight: 'bold' }}>إجمالي الفاتورة:</td>
                        <td colSpan="2" style={{ fontSize: '1.2rem', fontWeight: 'bold' }} className="text-primary">{cartTotal} {form.currency}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            )}

            <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
              <div className="form-group mb-4" style={{ flex: '2 1 200px' }}>
                <label>البيان / الوصف</label>
                <input type="text" name="description" className="form-control" value={form.description} onChange={handleInputChange} placeholder="مثال: فاتورة مورد، مصاريف..." />
              </div>
              <div className="form-group mb-4" style={{ flex: '1 1 150px' }}>
                <label>الشخص المعني (اختياري)</label>
                <input type="text" name="person" className="form-control" value={form.person} onChange={handleInputChange} placeholder="عمار، أيهم..." />
              </div>
            </div>

            <button type="submit" className={`btn btn-primary`} style={{ width: '100%', background: 'var(--primary)', color: '#000' }} disabled={submitting}>
              {submitting ? 'جاري المعالجة...' : (isCartMode ? `اعتماد الفاتورة (قيمة: ${cartTotal} ${form.currency})` : 'حفظ الحركة')}
            </button>
          </form>
        )}

        {/* Currency Exchange Form */}
        {entryMode === 'exchange' && (
          <form onSubmit={handleExchangeSubmit}>
            <div className="mb-4">
              <p className="text-muted">نقص الدولار من الصندوق لاضافة الليرة فوراً بحسب سعر الصرف</p>
            </div>
            <div className="flex gap-4" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <div className="form-group" style={{ flex: '1 1 200px' }}>
                <label>دولار للتصريف</label>
                <input type="number" name="usdAmount" className="form-control" value={exchangeForm.usdAmount} onChange={handleExchangeInputChange} min="1" step="0.01" />
              </div>
              <div><ArrowRightLeft size={24} className="text-muted" /></div>
              <div className="form-group" style={{ flex: '1 1 200px' }}>
                <label>مستلم بالليرة</label>
                <input type="number" name="estimatedTry" className="form-control" value={exchangeForm.estimatedTry} onChange={handleExchangeInputChange} step="0.01" />
              </div>
            </div>
            <button type="submit" className="btn mt-4" style={{ width: '100%', background: 'var(--sale)', color: '#fff' }} disabled={submitting || !exchangeRate}>اعتماد الصرافة المزدوجة</button>
          </form>
        )}
      </div>

      {/* Inventory Dashboard Bar */}
      <div className="card mb-6">
        <h3 className="flex items-center gap-2 mb-4 text-primary"><Package size={20} /> جرد المخزون السريع</h3>
        <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
          {products.map(p => (
            <div key={p.id} style={{ minWidth: '150px', background: 'var(--input-bg)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--input-border)' }}>
              <h4 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>{p.name}</h4>
              <p className="text-muted" style={{ fontSize: '0.8rem' }}>متاح للبيع (كمية)</p>
              <p style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{Number(p.stock_quantity).toLocaleString()}</p>
              <div style={{ borderTop: '1px dashed var(--input-border)', margin: '0.5rem 0', paddingTop: '0.5rem' }}>
                <p className="text-muted" style={{ fontSize: '0.7rem' }}>متوسط التكلفة:</p>
                <p style={{ fontSize: '0.9rem' }}>{p.average_cost_usd > 0 ? `${Number(p.average_cost_usd).toFixed(2)}$` : '--'}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Ledger History ... (Condensed rendering for transactions) */}
      <div className="card">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2"><LayoutGrid size={20} className="text-yellow" /> سجل الحركات الأخير</h3>
        </div>
        
        {loading ? <p>جاري التحميل...</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {filteredTransactions.map((t) => (
              <div key={t.id} style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--input-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--card-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {getTypeIcon(t.type)}
                  </div>
                  <div>
                    <h4 style={{ fontSize: '1.05rem' }}>{t.description}</h4>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      {getTypeLabel(t.type)} • {format(new Date(t.created_at), 'dd/MM/yyyy p')}
                    </p>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <h3 className={getTypeColorClass(t.type)} dir="ltr" style={{ fontSize: '1.2rem' }}>
                    {(t.type==='deposit'||t.type==='sale')?'+':'-'}{Number(t.total_amount).toLocaleString()} {t.currency === 'USD' ? '$' : 'TL'}
                  </h3>
                  {t.type === 'sale' && (
                    <button onClick={() => handlePrintInvoice(t)} className="no-print" style={{ background: 'transparent', color: 'var(--sale)', padding: '0.2rem' }} title="تصدير كـ PDF"><Printer size={18} /></button>
                  )}
                  <button onClick={() => handleDeleteTransaction(t)} className="no-print" style={{ background: 'transparent', color: 'var(--danger)', padding: '0.2rem' }}><Trash2 size={18} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Invoice Print Overlay */}
      {printingInvoice && (
        <div id="invoice-print-area" dir="ltr" style={{ 
          position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', 
          background: 'white', zIndex: 9999, overflowY: 'auto' 
        }}>
          <div style={{ padding: '40px', maxWidth: '800px', margin: '0 auto', fontFamily: 'sans-serif' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #eee', paddingBottom: '20px', marginBottom: '30px' }}>
              <div>
                <h1 style={{ color: '#333', margin: 0, fontSize: '32px', fontWeight: '900' }}>INVOICE</h1>
                <p style={{ color: '#666', margin: '5px 0', fontWeight: 'bold' }}>AR Wholesale</p>
                <p style={{ color: '#666', margin: 0 }}>Date: {format(new Date(printingInvoice.transaction.created_at), 'MMM dd, yyyy - HH:mm')}</p>
                <p style={{ color: '#a0a0a0', margin: '5px 0 0 0', fontSize: '12px' }}>TRX: {printingInvoice.transaction.id.split('-')[0]}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ color: '#888', margin: '0 0 5px 0' }}>Billed To:</p>
                <h3 style={{ color: '#333', margin: 0, fontSize: '20px' }}>{printingInvoice.transaction.person || 'Valued Customer'}</h3>
              </div>
            </div>
            
            {/* Items Table */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '30px' }}>
              <thead>
                <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
                  <th style={{ padding: '12px', textAlign: 'left', color: '#333' }}>Description</th>
                  <th style={{ padding: '12px', textAlign: 'center', color: '#333' }}>Qty</th>
                  <th style={{ padding: '12px', textAlign: 'right', color: '#333' }}>Unit Price</th>
                  <th style={{ padding: '12px', textAlign: 'right', color: '#333' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {printingInvoice.items.map((item, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '12px', color: '#444', fontWeight: '500' }}>{item.inventory_items?.name || 'Item'}</td>
                    <td style={{ padding: '12px', textAlign: 'center', color: '#444' }}>{item.quantity}</td>
                    <td style={{ padding: '12px', textAlign: 'right', color: '#444' }}>
                      {Number(item.unit_price).toLocaleString()} {printingInvoice.transaction.currency}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right', color: '#444', fontWeight: 'bold' }}>
                      {(Number(item.quantity) * Number(item.unit_price)).toLocaleString()} {printingInvoice.transaction.currency}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            
            {/* Footer calculations */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ width: '50%', color: '#666', fontSize: '14px' }}>
                <p><strong>Note:</strong> {printingInvoice.transaction.description}</p>
                <p style={{ marginTop: '20px' }}>Thank you for your business!</p>
              </div>
              <div style={{ width: '40%', background: '#f8f9fa', padding: '20px', borderRadius: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <span style={{ color: '#555' }}>Subtotal:</span>
                  <span style={{ color: '#333', fontWeight: 'bold' }}>{Number(printingInvoice.transaction.total_amount).toLocaleString()} {printingInvoice.transaction.currency}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid #ddd', paddingTop: '10px' }}>
                  <span style={{ color: '#333', fontWeight: 'bold', fontSize: '18px' }}>Total Amount:</span>
                  <span style={{ color: '#22c55e', fontWeight: 'bold', fontSize: '18px' }}>
                    {Number(printingInvoice.transaction.total_amount).toLocaleString()} {printingInvoice.transaction.currency}
                  </span>
                </div>
              </div>
            </div>

            {/* Print Controls (Hidden on paper) */}
            <div className="no-print" style={{ marginTop: '40px', display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button className="btn" onClick={() => window.print()} style={{ background: '#22c55e', color: 'black', padding: '10px 20px', borderRadius: '5px', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>Print / Save PDF</button>
              <button className="btn" onClick={() => setPrintingInvoice(null)} style={{ background: '#f87171', color: 'white', padding: '10px 20px', borderRadius: '5px', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>Close & Back</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
