import { useState, useEffect, useMemo } from 'react';
import { supabase } from './lib/supabase';
import { Toaster, toast } from 'react-hot-toast';
import { 
  ArrowDownRight, ArrowUpRight, Plus, RefreshCw, 
  Wallet, LayoutGrid, Trash2, Edit, Search, X, 
  ArrowRightLeft, Globe, Gem, Package, ShoppingCart, Printer,
  CheckCircle, Clock, CreditCard, Filter, Eye, Calendar, TrendingUp
} from 'lucide-react';
import { format } from 'date-fns';

function App() {
  const [transactions, setTransactions] = useState([]);
  const [products, setProducts] = useState([]);
  const [contacts, setContacts] = useState([]);
  
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
  const [showFiltersModal, setShowFiltersModal] = useState(false);
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  // Ledger Pagination
  const [currentPage, setCurrentPage] = useState(1);

  // Modals State
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [viewingTransaction, setViewingTransaction] = useState(null);
  const [editForm, setEditForm] = useState({ description: '', person: '', amount: '' });

  // Profit Reports State
  const [showProfitModal, setShowProfitModal] = useState(false);
  const [profitTimeframe, setProfitTimeframe] = useState('month'); // 'month' or 'all'
  const [profitMonth, setProfitMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [profitData, setProfitData] = useState(null);
  const [loadingProfit, setLoadingProfit] = useState(false);

  // Balances
  const [balances, setBalances] = useState({ USD: 0, TRY: 0 });

  // Form State - Single Transaction & Invoice
  const [form, setForm] = useState({
    type: 'deposit',
    amount: '', // Used for deposit/expense/withdrawal
    currency: 'USD',
    description: '',
    person: '',
    customer_address: '',
    discount: '',
    status: 'completed', // completed, pending, installment
    paid_amount: '' // initial installment payment
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
  const [invoiceLang, setInvoiceLang] = useState('en'); // 'en' or 'tr'

  // Add Product State
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [newProductName, setNewProductName] = useState('');

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
      toast.error('Error connecting to exchange rate service');
    } finally {
      setLoadingRate(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    // Fetch Inventory
    const resProducts = await supabase.from('inventory_items').select('*').order('name');
    if (resProducts.data) setProducts(resProducts.data);

    // Fetch Contacts
    const resContacts = await supabase.from('contacts').select('*').order('name');
    if (resContacts.data) setContacts(resContacts.data);

    // Fetch Transactions
    const resTrans = await supabase.from('transactions').select('*').order('created_at', { ascending: false });
    if (resTrans.error) {
      toast.error('Error fetching transactions');
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
      // Ignore cash impact for pending sales or installment purchases directly.
      // (Their cash impact is handled via related deposits/expenses when paid).
      if ((t.type === 'sale' && t.status === 'pending') || 
          (t.type === 'purchase' && t.status === 'installment')) {
        return;
      }

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

  const handleQuickEdit = (t) => {
    setEditingTransaction(t);
    setEditForm({
      description: t.description || '',
      person: t.person || '',
      amount: t.total_amount || ''
    });
  };

  const handleSaveQuickEdit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    
    // Safety check: Prevent editing total_amount for purchases and sales
    const isCartTx = editingTransaction.type === 'sale' || editingTransaction.type === 'purchase';
    
    const updates = {
      description: editForm.description,
      person: editForm.person,
    };

    if (!isCartTx && editForm.amount) {
      updates.total_amount = Number(editForm.amount);
    }

    const { error } = await supabase.from('transactions').update(updates).eq('id', editingTransaction.id);
    
    if (error) {
      toast.error('Error during edit');
    } else {
      toast.success('Edited successfully');
      setEditingTransaction(null);
      fetchData();
    }
    setSubmitting(false);
  };

  const handleViewDetails = async (t) => {
    setLoading(true);
    const { data: items } = await supabase
      .from('transaction_items')
      .select('*, inventory_items(name)')
      .eq('transaction_id', t.id);
    setLoading(false);
    
    setViewingTransaction({ transaction: t, items: items || [] });
  };

  const generateProfitReport = async () => {
    setLoadingProfit(true);
    setProfitData(null);
    try {
      let monthTxs;
      
      if (profitTimeframe === 'all') {
        const { data, error: txErr } = await supabase
          .from('transactions')
          .select('*');
        if (txErr) throw txErr;
        monthTxs = data;
      } else {
        const [year, month] = profitMonth.split('-');
        const startDate = new Date(year, month - 1, 1).toISOString();
        const endDate = new Date(year, month, 1).toISOString(); // 1st of next month

        // Fetch transactions for the month
        const { data, error: txErr } = await supabase
          .from('transactions')
          .select('*')
          .gte('created_at', startDate)
          .lt('created_at', endDate);

        if (txErr) throw txErr;
        monthTxs = data;
      }

      // Filter relevant transactions
      const sales = monthTxs.filter(t => t.type === 'sale');
      const expenses = monthTxs.filter(t => t.type === 'expense' || t.type === 'withdrawal');

      // Fetch transaction items for sales to get COGS
      let totalCogsUsd = 0;
      if (sales.length > 0) {
        const saleIds = sales.map(s => s.id);
        const { data: saleItems, error: itemsErr } = await supabase
          .from('transaction_items')
          .select('*')
          .in('transaction_id', saleIds);
        
        if (itemsErr) throw itemsErr;

        saleItems.forEach(item => {
          totalCogsUsd += Number(item.quantity) * Number(item.unit_cost_usd_at_time || 0);
        });
      }

      let totalSalesRevenueUsd = 0;
      let totalDiscountsUsd = 0;
      sales.forEach(s => {
        let revenue = Number(s.total_amount); // Note: total_amount already has discount subtracted!
        let discount = Number(s.discount_amount || 0);
        
        if (s.currency === 'TRY' && s.exchange_rate_used) {
          revenue = revenue / Number(s.exchange_rate_used);
          discount = discount / Number(s.exchange_rate_used);
        }
        totalSalesRevenueUsd += revenue;
        totalDiscountsUsd += discount;
      });

      let totalExpensesUsd = 0;
      expenses.forEach(e => {
        let amount = Number(e.total_amount);
        if (e.currency === 'TRY' && e.exchange_rate_used) {
          amount = amount / Number(e.exchange_rate_used);
        }
        totalExpensesUsd += amount;
      });

      // totalSalesRevenueUsd is the FINAL revenue (money received or owed).
      // If we want original revenue: originalRevenue = totalSalesRevenueUsd + totalDiscountsUsd
      const grossProfitUsd = totalSalesRevenueUsd - totalCogsUsd;
      const netProfitUsd = grossProfitUsd - totalExpensesUsd;

      setProfitData({
        totalSalesRevenueUsd,
        totalCogsUsd,
        totalDiscountsUsd,
        grossProfitUsd,
        totalExpensesUsd,
        netProfitUsd,
        salesCount: sales.length,
        expensesCount: expenses.length
      });

    } catch (err) {
      toast.error('Error generating profit report');
    } finally {
      setLoadingProfit(false);
    }
  };

  const handleAddProduct = async (e) => {
    e.preventDefault();
    if (!newProductName.trim()) {
      toast.error('Please enter a product name');
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from('inventory_items').insert([{
      name: newProductName.trim(),
      stock_quantity: 0,
      average_cost_usd: 0
    }]);

    if (error) {
      toast.error('Error adding product');
    } else {
      toast.success('Product added successfully');
      setNewProductName('');
      setShowAddProductModal(false);
      fetchData();
    }
    setSubmitting(false);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    let updates = { [name]: value };
    
    if (name === 'type') {
      updates.person = '';
      updates.status = 'completed';
      updates.paid_amount = '';
    }

    // Auto-fill address if selecting an existing contact
    if (name === 'person') {
      const existingContact = contacts.find(c => c.name === value);
      if (existingContact && existingContact.address) {
        updates.customer_address = existingContact.address;
      }
    }

    setForm({ ...form, ...updates });
  };

  const handleCartItemChange = (e) => {
    setCartItem({ ...cartItem, [e.target.name]: e.target.value });
  };

  const addCartItem = () => {
    if (!cartItem.product_id || !cartItem.quantity || !cartItem.unit_price) {
      toast.error('Please fill in all item details');
      return;
    }
    const prd = products.find(p => p.id === cartItem.product_id);
    
    // Check Stock if Sale
    if (form.type === 'sale') {
      const currentCartQty = cart.filter(c => c.product_id === prd.id).reduce((sum, c) => sum + Number(c.quantity), 0);
      if (Number(cartItem.quantity) + currentCartQty > prd.stock_quantity) {
        toast.error(`Required sale quantity not available in stock! Available: ${prd.stock_quantity}`);
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
    setForm({ ...form, amount: '', description: '', person: '', customer_address: '', discount: '', status: 'completed', paid_amount: '' });
    setCart([]);
    setCartItem({ product_id: '', quantity: '', unit_price: '' });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Determine the total amount
    let subTotal = isCartMode ? cartTotal : Number(form.amount);
    let discountAmt = Number(form.discount || 0);
    const totalAmount = subTotal - discountAmt;

    if (totalAmount < 0) {
      toast.error('Error: Discount is greater than total');
      return;
    }

    if (totalAmount === 0 && !isCartMode) {
      toast.error('Error: No valid amount specified for cash');
      return;
    }
    if (!form.description) {
      toast.error('Please enter a description');
      return;
    }

    // STRICT BALANCE CHECK constraint from User
    if (form.type === 'purchase' || form.type === 'expense' || form.type === 'withdrawal') {
      let requiredCash = totalAmount;
      if (form.type === 'purchase' && form.status === 'installment') {
        requiredCash = Number(form.paid_amount || 0);
      }

      if (requiredCash > balances[form.currency]) {
        toast.error(`Your cash balance for currency ${form.currency} is insufficient! Please perform an exchange first.`);
        return;
      }
    }

    if (isCartMode && cart.length === 0) {
      toast.error('Please add items to the invoice');
      return;
    }

    setSubmitting(true);
    
    // Manage Contact
    if (form.person) {
      const existingContact = contacts.find(c => c.name === form.person);
      if (!existingContact) {
        const contactType = form.type === 'sale' ? 'customer' : 'supplier';
        await supabase.from('contacts').insert([{ name: form.person, address: form.customer_address, type: contactType }]);
      } else if (form.customer_address && !existingContact.address) {
        await supabase.from('contacts').update({ address: form.customer_address }).eq('id', existingContact.id);
      }
    }

    // 1. Insert Transaction Master
    const { data: trxResult, error: trxErr } = await supabase.from('transactions').insert([{
      type: form.type,
      total_amount: totalAmount,
      currency: form.currency,
      exchange_rate_used: exchangeRate,
      description: form.description,
      person: form.person || null,
      customer_address: form.customer_address || null,
      discount_amount: discountAmt,
      status: form.status
    }]).select();

    if (trxErr) {
      toast.error('Error adding transaction');
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

    // Handle initial installment payment if any
    if (form.type === 'purchase' && form.status === 'installment' && Number(form.paid_amount || 0) > 0) {
      await supabase.from('transactions').insert([{
        type: 'expense',
        total_amount: Number(form.paid_amount),
        currency: form.currency,
        exchange_rate_used: exchangeRate,
        description: `Initial payment for purchase invoice (installment) - ${form.description}`,
        person: form.person || null,
        parent_id: transactionId
      }]);
    }

    toast.success('Transaction completed successfully');
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
      toast.error('Please enter amount to exchange');
      return;
    }

    // STRICT BALANCE CHECK validation for Exchange
    if (Number(exchangeForm.usdAmount) > balances.USD) {
       toast.error(`Insufficient USD balance to complete the exchange! Available: ${balances.USD}$`);
       return;
    }

    if (!window.confirm(`Confirm exchange of ${exchangeForm.usdAmount}$ ?`)) return;
    setSubmitting(true);
    
    const { error } = await supabase.from('transactions').insert([
      {
        type: 'withdrawal', total_amount: Number(exchangeForm.usdAmount), currency: 'USD',
        description: `Exchange conversion (Rate: ${exchangeRate?.toFixed(4)})`, person: 'System'
      },
      {
        type: 'deposit', total_amount: Number(exchangeForm.estimatedTry), currency: 'TRY',
        description: `Exchange receipt (for ${exchangeForm.usdAmount}$)`, person: 'System', exchange_rate_used: exchangeRate
      }
    ]);

    if (error) toast.error('Error during exchange');
    else {
      toast.success('Exchange successful');
      setExchangeForm({ usdAmount: '', estimatedTry: '' });
      fetchData();
    }
    setSubmitting(false);
  };

  const handleDeleteTransaction = async (t) => {
    const isInventoryTx = t.type === 'purchase' || t.type === 'sale';
    if (!window.confirm(isInventoryTx 
      ? 'Are you sure you want to delete this returned invoice? Its financial impact will be reversed and quantities returned to stock automatically.' 
      : 'Are you sure you want to delete this transaction? Its financial impact will be reversed.')) return;
    
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
      toast.error('Error during deletion');
    } else {
      toast.success('Automatic deletion and return successful');
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
      toast.error('Cannot fetch invoice details for printing');
    }
  };

  const handleCompleteSale = async (t) => {
    if (!window.confirm('Are you sure you want to receive the invoice amount and confirm payment?')) return;
    setSubmitting(true);
    const { error } = await supabase.from('transactions').update({ 
      status: 'completed',
      created_at: new Date().toISOString()
    }).eq('id', t.id);
    
    if (error) toast.error('Error during confirmation');
    else { toast.success('Invoice collected successfully'); fetchData(); }
    setSubmitting(false);
  };

  const handleAddInstallmentPayment = async (parentTrx) => {
    const amountStr = window.prompt(`Enter the payment amount in ${parentTrx.currency}:`);
    if (!amountStr) return;
    const amount = Number(amountStr);
    if (isNaN(amount) || amount <= 0) return;
    
    if (amount > balances[parentTrx.currency]) {
      toast.error('Cash balance is insufficient to pay this amount');
      return;
    }
    
    setSubmitting(true);
    const { error } = await supabase.from('transactions').insert([{
      type: 'expense',
      total_amount: amount,
      currency: parentTrx.currency,
      description: `Payment for purchase invoice ${parentTrx.invoice_number ? '#' + parentTrx.invoice_number : ''} - ${parentTrx.person || ''}`,
      person: parentTrx.person,
      parent_id: parentTrx.id
    }]);
    
    if (error) toast.error('Error recording payment');
    else { toast.success('Payment recorded successfully'); fetchData(); }
    setSubmitting(false);
  };

  const getTypeLabel = (type) => ({deposit:'Deposit',withdrawal:'Withdrawal',purchase:'Purchases',sale:'Sales',expense:'Expenses'})[type] || type;
  const getTypeColorClass = (type) => (type === 'deposit' || type === 'sale') ? 'text-green' : 'text-red';
  const getTypeIcon = (type) => (type === 'deposit' || type === 'sale') ? <ArrowDownRight size={20} className="text-green" /> : <ArrowUpRight size={20} className="text-red" />;

  const filteredTransactions = transactions.filter(t => {
    // Basic search
    const matchesSearch = t.description.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         (t.person && t.person.toLowerCase().includes(searchQuery.toLowerCase()));
    
    // Dropdowns
    const matchesType = filterType === 'all' || t.type === filterType;
    const matchesCurrency = filterCurrency === 'all' || t.currency === filterCurrency;
    
    // Dates
    let matchesDate = true;
    if (filterStartDate) {
      matchesDate = matchesDate && new Date(t.created_at) >= new Date(filterStartDate);
    }
    if (filterEndDate) {
      const end = new Date(filterEndDate);
      end.setDate(end.getDate() + 1); // inclusive of the end date
      matchesDate = matchesDate && new Date(t.created_at) < end;
    }

    return matchesSearch && matchesType && matchesCurrency && matchesDate;
  });

  const handleResetFilters = () => {
    setSearchQuery('');
    setFilterType('all');
    setFilterCurrency('all');
    setFilterStartDate('');
    setFilterEndDate('');
    setCurrentPage(1);
  };

  const ITEMS_PER_PAGE = 25;
  const totalPages = Math.max(1, Math.ceil(filteredTransactions.length / ITEMS_PER_PAGE));
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedTransactions = filteredTransactions.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const pendingSales = transactions.filter(t => t.type === 'sale' && t.status === 'pending');
  const installmentPurchases = transactions.filter(t => t.type === 'purchase' && t.status === 'installment');

  const totalDebts = useMemo(() => {
    return installmentPurchases.reduce((acc, t) => {
      const paidTx = transactions.filter(child => child.parent_id === t.id);
      const totalPaid = paidTx.reduce((sum, child) => sum + Number(child.total_amount), 0);
      const remaining = Number(t.total_amount) - totalPaid;
      if (remaining > 0) {
        acc[t.currency] = (acc[t.currency] || 0) + remaining;
      }
      return acc;
    }, { USD: 0, TRY: 0 });
  }, [installmentPurchases, transactions]);

  return (
    <div className="container">
      <Toaster position="top-center" />
      
      <header className="flex items-center justify-between mb-6">
        <h1 className="flex items-center gap-2">
          <img src="/logo.jpg" alt="AR Wholesale Logo" style={{ height: '36px', borderRadius: '4px', objectFit: 'contain', background: '#fff' }} />
        </h1>
        <div className="flex gap-2">
          <button onClick={() => setShowProfitModal(true)} className="btn flex items-center gap-2" style={{ padding: '0.5rem 1rem', background: 'var(--sale)', color: '#fff' }}>
            <TrendingUp size={18} /> Profit Reports
          </button>
          <button onClick={() => { fetchData(); fetchExchangeRate(); }} className="btn" style={{ padding: '0.5rem', background: 'var(--card-bg)' }}>
            <RefreshCw size={20} className={(loading || loadingRate) ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      {/* Unified Dashboards */}
      {unifiedNetWorth !== null && (
        <div className="card mb-4" style={{ background: 'linear-gradient(135deg, rgba(74,222,128,0.1), rgba(96,165,250,0.1))', border: '1px solid rgba(74,222,128,0.2)'}}>
          <div className="flex justify-between items-center" style={{ flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h3 className="flex items-center gap-2 text-primary mb-2" style={{ fontSize: '1rem' }}>
                <Gem size={18} /> Available Liquidity in USD
              </h3>
              <h1 dir="ltr" style={{ fontSize: '2.5rem', margin: 0 }}>
                $ {unifiedNetWorth.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h1>
            </div>
            <div>
              <h3 className="flex items-center gap-2 text-blue mb-2" style={{ fontSize: '1rem' }}>
                <Package size={18} /> Locked Inventory in USD
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
          <p className="text-muted mb-2">USD Balance ($)</p>
          <h2 style={{ fontSize: '2rem', color: balances.USD >= 0 ? 'var(--primary)' : 'var(--danger)' }} dir="ltr">{balances.USD.toLocaleString()} $</h2>
        </div>
        <div style={{ flex: '1 1 200px', borderRight: '1px solid var(--card-border)', paddingRight: '1rem' }}>
          <p className="text-muted mb-2">TRY Balance (TL)</p>
          <h2 style={{ fontSize: '2rem', color: balances.TRY >= 0 ? 'var(--primary)' : 'var(--danger)' }} dir="ltr">{balances.TRY.toLocaleString()} TL</h2>
        </div>
      </div>

      {/* Mode Switcher */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button onClick={() => { setEntryMode('single'); clearExchangeForm(); }} className="btn" style={{ flex: 1, background: entryMode === 'single' ? 'var(--card-bg)' : 'transparent', borderBottom: entryMode === 'single' ? '2px solid var(--primary)' : '2px solid transparent' }}>
          <Plus size={18} style={{ display: 'inline', marginInlineEnd: '6px' }} /> Record Transaction / Invoice
        </button>
        <button onClick={() => { setEntryMode('exchange'); clearForm(); }} className="btn" style={{ flex: 1, background: entryMode === 'exchange' ? 'var(--card-bg)' : 'transparent', borderBottom: entryMode === 'exchange' ? '2px solid var(--sale)' : '2px solid transparent' }}>
          <ArrowRightLeft size={18} style={{ display: 'inline', marginInlineEnd: '6px' }} /> Currency Exchange
        </button>
      </div>

      {/* Main Forms */}
      <div className="card mb-6" style={{ border: '1px solid var(--card-border)', borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
        
        {/* Single / Invoice Form */}
        {entryMode === 'single' && (
          <form onSubmit={handleSubmit}>
            <div className="flex gap-3" style={{ flexWrap: 'wrap', marginBottom: '1rem' }}>
              <div className="form-group" style={{ flex: '1 1 150px' }}>
                <label>Transaction Type</label>
                <select name="type" className="form-control" value={form.type} onChange={handleInputChange}>
                  <option value="deposit">Income Deposit</option>
                  <option value="sale">Sales Invoice (Goods)</option>
                  <option value="purchase">Purchase Invoice (Goods)</option>
                  <option value="expense">Pay Expense</option>
                  <option value="withdrawal">Cash Withdrawal</option>
                </select>
              </div>

              <div className="form-group" style={{ flex: '1 1 100px' }}>
                <label>Currency</label>
                <select name="currency" className="form-control" value={form.currency} onChange={handleInputChange}>
                  <option value="USD">USD ($)</option>
                  <option value="TRY">TRY (TL)</option>
                </select>
              </div>

              {/* Amount is only direct input if NOT cart mode */}
              {!isCartMode && (
                <div className="form-group" style={{ flex: '1 1 120px' }}>
                  <label>Total Amount</label>
                  <input type="number" name="amount" className="form-control" value={form.amount} onChange={handleInputChange} min="0.01" step="0.01" dir="ltr" />
                </div>
              )}
            </div>

            {/* Cart Section if Sale or Purchase */}
            {isCartMode && (
              <div style={{ background: 'var(--input-bg)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', border: '1px solid var(--input-border)' }}>
                <h4 className="mb-4 flex items-center gap-2"><ShoppingCart size={18} className="text-sale" /> Item Cart ({form.type === 'sale' ? 'Sales Invoice' : 'Purchase Invoice'})</h4>
                
                <div className="flex gap-2" style={{ flexWrap: 'wrap', marginBottom: '1rem' }}>
                  <div className="form-group" style={{ flex: '1 1 150px', margin: 0 }}>
                    <select name="product_id" className="form-control" value={cartItem.product_id} onChange={handleCartItemChange}>
                      <option value="">Select Item...</option>
                      {products.map(p => (
                         <option key={p.id} value={p.id}>
                           {p.name} {form.type === 'sale' ? `(Available: ${p.stock_quantity})` : ''}
                         </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group" style={{ flex: '1 1 80px', margin: 0 }}>
                    <input type="number" name="quantity" placeholder="Qty" className="form-control" value={cartItem.quantity} onChange={handleCartItemChange} min="1" />
                  </div>
                  <div className="form-group" style={{ flex: '1 1 100px', margin: 0 }}>
                    <input type="number" name="unit_price" placeholder={`Unit price in ${form.currency}`} className="form-control" value={cartItem.unit_price} onChange={handleCartItemChange} step="0.01" />
                  </div>
                  <button type="button" onClick={addCartItem} className="btn" style={{ background: 'var(--primary)', color: '#000', padding: '0.6rem 1rem' }}>
                    Add +
                  </button>
                </div>

                {/* Cart Preview */}
                {cart.length > 0 && (
                  <table style={{ width: '100%', fontSize: '0.9rem', textAlign: 'right', borderCollapse: 'collapse' }}>
                    <thead style={{ borderBottom: '1px solid var(--card-border)' }}>
                      <tr><th>Item</th><th>Qty</th><th>Unit Price</th><th>Total</th><th></th></tr>
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
                        <td colSpan="3" style={{ padding: '1rem 0', fontWeight: 'bold' }}>Total Items:</td>
                        <td colSpan="2" style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{cartTotal} {form.currency}</td>
                      </tr>
                      <tr>
                        <td colSpan="3" style={{ padding: '0.5rem 0', fontWeight: 'bold' }}>Discount Given:</td>
                        <td colSpan="2">
                          <input type="number" name="discount" className="form-control" value={form.discount} onChange={handleInputChange} min="0" step="0.01" placeholder="Discount Value" style={{ width: '100%' }} />
                        </td>
                      </tr>
                      <tr>
                        <td colSpan="3" style={{ padding: '1rem 0', fontWeight: 'bold', borderTop: '2px solid var(--card-border)' }}>Final Total:</td>
                        <td colSpan="2" style={{ fontSize: '1.4rem', fontWeight: 'bold', borderTop: '2px solid var(--card-border)' }} className="text-primary">
                          {Math.max(0, cartTotal - Number(form.discount || 0))} {form.currency}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            )}

            <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
              <div className="form-group mb-4" style={{ flex: '2 1 200px' }}>
                <label>Description</label>
                <input type="text" name="description" className="form-control" value={form.description} onChange={handleInputChange} placeholder="e.g., supplier invoice, expenses..." />
              </div>
              
              <div className="form-group mb-4" style={{ flex: '1 1 150px' }}>
                <label>{(form.type === 'expense' || form.type === 'withdrawal') ? 'Expense Type / Entity' : 'Name / Company'}</label>
                {form.type === 'expense' ? (
                  <select name="person" className="form-control" value={form.person} onChange={handleInputChange}>
                    <option value="">Select payment entity...</option>
                    <option value="Porter">Porter</option>
                    <option value="Bill">Bill</option>
                    <option value="Other">Other</option>
                  </select>
                ) : form.type === 'withdrawal' ? (
                  <select name="person" className="form-control" value={form.person} onChange={handleInputChange}>
                    <option value="">Select withdrawal reason...</option>
                    <option value="Food">Food</option>
                    <option value="Ayham's Expense">Ayham's Expense</option>
                    <option value="Other">Other</option>
                  </select>
                ) : (
                  <>
                    <input type="text" list="contacts-list" name="person" className="form-control" value={form.person} onChange={handleInputChange} placeholder="Search or add new name..." autoComplete="off" />
                    <datalist id="contacts-list">
                      {contacts.map(c => <option key={c.id} value={c.name} />)}
                    </datalist>
                  </>
                )}
              </div>

              {isCartMode && (
                <div className="form-group mb-4" style={{ flex: '1 1 200px' }}>
                  <label>Address (for invoice)</label>
                  <input type="text" name="customer_address" className="form-control" value={form.customer_address} onChange={handleInputChange} placeholder="Address or Details" />
                </div>
              )}
            </div>

            {/* Checkboxes for Installments and Pending */}
            {form.type === 'sale' && (
              <div className="mb-4 flex items-center gap-2" style={{ background: 'var(--input-bg)', padding: '1rem', borderRadius: '8px' }}>
                <input type="checkbox" id="pending_sale" checked={form.status === 'pending'} onChange={(e) => setForm({...form, status: e.target.checked ? 'pending' : 'completed'})} style={{ width: '20px', height: '20px' }} />
                <label htmlFor="pending_sale" style={{ cursor: 'pointer', margin: 0 }}>Pending Sale (Not yet due/paid)</label>
              </div>
            )}

            {form.type === 'purchase' && (
              <div className="mb-4" style={{ background: 'var(--input-bg)', padding: '1rem', borderRadius: '8px' }}>
                <div className="flex items-center gap-2 mb-2">
                  <input type="checkbox" id="installment_purchase" checked={form.status === 'installment'} onChange={(e) => setForm({...form, status: e.target.checked ? 'installment' : 'completed'})} style={{ width: '20px', height: '20px' }} />
                  <label htmlFor="installment_purchase" style={{ cursor: 'pointer', margin: 0 }}>Installment Purchase Invoices (Debt)</label>
                </div>
                {form.status === 'installment' && (
                  <div className="form-group mt-3 mb-0">
                    <label>Initial Payment from Cash</label>
                    <input type="number" name="paid_amount" className="form-control" value={form.paid_amount} onChange={handleInputChange} min="0" step="0.01" placeholder="e.g. 500" />
                  </div>
                )}
              </div>
            )}

            <button type="submit" className={`btn btn-primary`} style={{ width: '100%', background: 'var(--primary)', color: '#000' }} disabled={submitting}>
              {submitting ? 'Processing...' : (isCartMode ? `Submit Invoice (Total: ${Math.max(0, cartTotal - Number(form.discount || 0))} ${form.currency})` : 'Save Transaction')}
            </button>
          </form>
        )}

        {/* Currency Exchange Form */}
        {entryMode === 'exchange' && (
          <form onSubmit={handleExchangeSubmit}>
            <div className="mb-4">
              <p className="text-muted">Deduct USD from cash to immediately add TRY based on the exchange rate</p>
            </div>
            <div className="flex gap-4" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <div className="form-group" style={{ flex: '1 1 200px' }}>
                <label>USD to Exchange</label>
                <input type="number" name="usdAmount" className="form-control" value={exchangeForm.usdAmount} onChange={handleExchangeInputChange} min="1" step="0.01" />
              </div>
              <div><ArrowRightLeft size={24} className="text-muted" /></div>
              <div className="form-group" style={{ flex: '1 1 200px' }}>
                <label>Received in TRY</label>
                <input type="number" name="estimatedTry" className="form-control" value={exchangeForm.estimatedTry} onChange={handleExchangeInputChange} step="0.01" />
              </div>
            </div>
            <button type="submit" className="btn mt-4" style={{ width: '100%', background: 'var(--sale)', color: '#fff' }} disabled={submitting || !exchangeRate}>Submit Dual Exchange</button>
          </form>
        )}
      </div>

      {/* Inventory Dashboard Bar */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="flex items-center gap-2 text-primary m-0"><Package size={20} /> Quick Inventory Check</h3>
          <button onClick={() => setShowAddProductModal(true)} className="btn flex items-center gap-2" style={{ padding: '0.4rem 0.8rem', background: 'var(--card-bg)', border: '1px solid var(--primary)', color: 'var(--primary)', fontSize: '0.9rem' }}>
            <Plus size={16} /> Add Product
          </button>
        </div>
        <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
          {products.map(p => (
            <div key={p.id} style={{ minWidth: '150px', background: 'var(--input-bg)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--input-border)' }}>
              <h4 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>{p.name}</h4>
              <p className="text-muted" style={{ fontSize: '0.8rem' }}>Available for Sale (Qty)</p>
              <p style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{Number(p.stock_quantity).toLocaleString()}</p>
              <div style={{ borderTop: '1px dashed var(--input-border)', margin: '0.5rem 0', paddingTop: '0.5rem' }}>
                <p className="text-muted" style={{ fontSize: '0.7rem' }}>Avg Cost:</p>
                <p style={{ fontSize: '0.9rem' }}>{p.average_cost_usd > 0 ? `${Number(p.average_cost_usd).toFixed(2)}$` : '--'}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pending Sales & Debts Dashboard */}
      {(pendingSales.length > 0 || installmentPurchases.length > 0) && (
        <div className="card mb-6" style={{ background: 'var(--input-bg)', border: '1px solid var(--card-border)' }}>
          {pendingSales.length > 0 && (
            <div className="mb-6">
              <h3 className="flex items-center gap-2 mb-4 text-warning"><Clock size={20} /> Pending Sales (Not Due)</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {pendingSales.map(t => (
                  <div key={t.id} style={{ background: 'var(--card-bg)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--input-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                    <div>
                      <h4 style={{ fontSize: '1.05rem', color: 'var(--warning)' }}>{t.person || 'Unspecified Customer'} {t.invoice_number ? `- Invoice #${t.invoice_number}` : ''}</h4>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t.description}</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <h3 className="text-warning" dir="ltr" style={{ fontSize: '1.2rem', margin: 0 }}>
                        {Number(t.total_amount).toLocaleString()} {t.currency === 'USD' ? '$' : 'TL'}
                      </h3>
                      <button onClick={() => handleCompleteSale(t)} className="btn" style={{ background: 'var(--primary)', color: '#000', padding: '0.4rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <CheckCircle size={16} /> Done (Paid)
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {installmentPurchases.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="flex items-center gap-2 text-danger m-0"><CreditCard size={20} /> Installment Purchase Invoices (Debts)</h3>
                <span dir="ltr" className="text-danger font-bold" style={{ fontSize: '1rem', background: 'rgba(239, 68, 68, 0.1)', padding: '0.3rem 0.8rem', borderRadius: '6px' }}>
                  Total: {totalDebts.USD > 0 && `${totalDebts.USD.toLocaleString()} $`}
                  {totalDebts.USD > 0 && totalDebts.TRY > 0 && ' | '}
                  {totalDebts.TRY > 0 && `${totalDebts.TRY.toLocaleString()} TL`}
                  {totalDebts.USD === 0 && totalDebts.TRY === 0 && '0'}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {installmentPurchases.map(t => {
                  const paidTx = transactions.filter(child => child.parent_id === t.id);
                  const totalPaid = paidTx.reduce((sum, child) => sum + Number(child.total_amount), 0);
                  const remaining = Number(t.total_amount) - totalPaid;
                  
                  if (remaining <= 0) return null; // Fully paid, shouldn't really happen if status is updated, but just in case.

                  return (
                    <div key={t.id} style={{ background: 'var(--card-bg)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--input-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                      <div>
                        <h4 style={{ fontSize: '1.05rem', color: 'var(--danger)' }}>{t.person || 'Unspecified Supplier'} {t.invoice_number ? `- Invoice #${t.invoice_number}` : ''}</h4>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t.description}</p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div style={{ textAlign: 'left', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                          Total: {Number(t.total_amount).toLocaleString()}<br/>
                          Paid: <span className="text-primary">{totalPaid.toLocaleString()}</span>
                        </div>
                        <h3 className="text-danger" dir="ltr" style={{ fontSize: '1.2rem', margin: 0, minWidth: '80px', textAlign: 'right' }}>
                          {remaining.toLocaleString()} {t.currency === 'USD' ? '$' : 'TL'}
                        </h3>
                        <button onClick={() => handleAddInstallmentPayment(t)} className="btn" style={{ background: 'var(--danger)', color: '#fff', padding: '0.4rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <Plus size={16} /> New Payment
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Ledger History */}
      <div className="card">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2"><LayoutGrid size={20} className="text-yellow" /> Recent Transactions Ledger</h3>
          <button onClick={() => setShowFiltersModal(true)} className="btn flex items-center gap-2" style={{ background: 'var(--input-bg)', color: 'var(--primary)', padding: '0.5rem 1rem' }}>
            <Filter size={18} /> Filter Transactions
          </button>
        </div>
        
        {loading ? <p>Loading...</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {paginatedTransactions.map((t) => (
              <div key={t.id} style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--input-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--card-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {getTypeIcon(t.type)}
                  </div>
                  <div>
                    <h4 style={{ fontSize: '1.05rem' }}>
                      {t.type === 'sale' && t.invoice_number ? `Sale - ${t.person || 'Unspecified Customer'} - Invoice Number: ${t.invoice_number}` : 
                       ((t.type === 'expense' || t.type === 'withdrawal') && t.person) ? `[${t.person}] ${t.description}` : 
                       t.description}
                      {t.status === 'pending' ? <span style={{ color: 'var(--warning)', fontSize: '0.8rem', paddingRight: '10px' }}>(Pending)</span> : null}
                    </h4>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      {getTypeLabel(t.type)} • {format(new Date(t.created_at), 'dd/MM/yyyy p')}
                    </p>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <h3 className={getTypeColorClass(t.type)} dir="ltr" style={{ fontSize: '1.2rem' }}>
                    {(t.type==='deposit'||t.type==='sale')?'+':'-'}{Number(t.total_amount).toLocaleString()} {t.currency === 'USD' ? '$' : 'TL'}
                  </h3>
                  {(t.type === 'sale' || t.type === 'purchase') && (
                    <button onClick={() => handleViewDetails(t)} className="no-print" style={{ background: 'transparent', color: 'var(--primary)', padding: '0.2rem' }} title="View Details"><Eye size={18} /></button>
                  )}
                  {t.type === 'sale' && (
                    <button onClick={() => handlePrintInvoice(t)} className="no-print" style={{ background: 'transparent', color: 'var(--sale)', padding: '0.2rem' }} title="Export as PDF"><Printer size={18} /></button>
                  )}
                  <button onClick={() => handleQuickEdit(t)} className="no-print" style={{ background: 'transparent', color: 'var(--warning)', padding: '0.2rem' }} title="Edit"><Edit size={18} /></button>
                  <button onClick={() => handleDeleteTransaction(t)} className="no-print" style={{ background: 'transparent', color: 'var(--danger)', padding: '0.2rem' }} title="Delete"><Trash2 size={18} /></button>
                </div>
              </div>
            ))}

            {totalPages > 1 && (
              <div className="flex gap-2 justify-center mt-4" style={{ alignItems: 'center' }}>
                <button 
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))} 
                  disabled={currentPage === 1}
                  className="btn" style={{ background: 'var(--input-bg)', opacity: currentPage === 1 ? 0.5 : 1 }}>
                  Previous
                </button>
                
                <span style={{ margin: '0 10px', fontWeight: 'bold' }}>
                  {currentPage} / {totalPages}
                </span>

                <button 
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} 
                  disabled={currentPage === totalPages}
                  className="btn" style={{ background: 'var(--input-bg)', opacity: currentPage === totalPages ? 0.5 : 1 }}>
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Invoice Print Overlay */}
      {printingInvoice && (
        <div id="invoice-print-area" dir="ltr" style={{ 
          position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', 
          background: 'white', zIndex: 9999, overflowY: 'auto' 
        }}>
          {(() => {
            const tr = (key) => {
              const dict = {
                'Invoice': { en: 'Invoice', tr: 'Fatura' },
                'Date:': { en: 'Date:', tr: 'Tarih:' },
                'TRX:': { en: 'TRX:', tr: 'İşlem No:' },
                'Billed To:': { en: 'Billed To:', tr: 'Sayın:' },
                'Invoice #': { en: 'Invoice #', tr: 'Fatura No: ' },
                'Description': { en: 'Description', tr: 'Açıklama' },
                'Qty': { en: 'Qty', tr: 'Miktar' },
                'Unit Price': { en: 'Unit Price', tr: 'Birim Fiyatı' },
                'Total': { en: 'Total', tr: 'Toplam' },
                'Note:': { en: 'Note:', tr: 'Not:' },
                'Status: UNPAID': { en: 'Status: UNPAID', tr: 'Durum: ÖDENMEDİ' },
                'Status: PAID': { en: 'Status: PAID', tr: 'Durum: ÖDENDİ' },
                'Thank you for your business!': { en: 'Thank you for your business!', tr: 'Bizi tercih ettiğiniz için teşekkür ederiz!' },
                'Subtotal:': { en: 'Subtotal:', tr: 'Ara Toplam:' },
                'Discount:': { en: 'Discount:', tr: 'İndirim:' },
                'Final Total:': { en: 'Final Total:', tr: 'Genel Toplam:' },
                'Valued Customer': { en: 'Valued Customer', tr: 'Değerli Müşteri' }
              };
              return dict[key] ? dict[key][invoiceLang] : key;
            };

            return (
              <div style={{ padding: '40px', maxWidth: '800px', margin: '0 auto', fontFamily: 'sans-serif' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #eee', paddingBottom: '20px', marginBottom: '30px' }}>
                  <div>
                    <img src="/logo.jpg" alt="AR Wholesale Logo" style={{ height: '60px', objectFit: 'contain', marginBottom: '10px' }} />
                    <h1 style={{ color: '#333', margin: 0, fontSize: '28px', fontWeight: '900', textTransform: 'uppercase' }}>{tr('Invoice')}</h1>
                    <p style={{ color: '#666', margin: '5px 0' }}>{tr('Date:')} {format(new Date(printingInvoice.transaction.created_at), 'MMM dd, yyyy - HH:mm')}</p>
                    <p style={{ color: '#a0a0a0', margin: '5px 0 0 0', fontSize: '12px' }}>{tr('TRX:')} {printingInvoice.transaction.id.split('-')[0]}</p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ color: '#888', margin: '0 0 5px 0' }}>{tr('Billed To:')}</p>
                    <h3 style={{ color: '#333', margin: 0, fontSize: '20px' }}>{printingInvoice.transaction.person || tr('Valued Customer')}</h3>
                    {printingInvoice.transaction.customer_address && (
                      <p style={{ color: '#555', margin: '5px 0 0 0', fontSize: '14px' }}>{printingInvoice.transaction.customer_address}</p>
                    )}
                    {printingInvoice.transaction.invoice_number && (
                      <p style={{ color: '#10b981', margin: '5px 0 0 0', fontWeight: 'bold' }}>{tr('Invoice #')}{printingInvoice.transaction.invoice_number}</p>
                    )}
                  </div>
                </div>
                
                {/* Items Table */}
                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '30px' }}>
                  <thead>
                    <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
                      <th style={{ padding: '12px', textAlign: 'left', color: '#333' }}>{tr('Description')}</th>
                      <th style={{ padding: '12px', textAlign: 'center', color: '#333' }}>{tr('Qty')}</th>
                      <th style={{ padding: '12px', textAlign: 'right', color: '#333' }}>{tr('Unit Price')}</th>
                      <th style={{ padding: '12px', textAlign: 'right', color: '#333' }}>{tr('Total')}</th>
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
                    <p><strong>{tr('Note:')}</strong> {printingInvoice.transaction.description}</p>
                    {printingInvoice.transaction.status === 'pending' && <p style={{ color: '#f59e0b', fontWeight: 'bold' }}>{tr('Status: UNPAID')}</p>}
                    {printingInvoice.transaction.status === 'completed' && <p style={{ color: '#10b981', fontWeight: 'bold' }}>{tr('Status: PAID')}</p>}
                    <p style={{ marginTop: '20px' }}>{tr('Thank you for your business!')}</p>
                  </div>
                  <div style={{ width: '40%', background: '#f8f9fa', padding: '20px', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                      <span style={{ color: '#555' }}>{tr('Subtotal:')}</span>
                      <span style={{ color: '#333', fontWeight: 'bold' }}>
                        {(Number(printingInvoice.transaction.total_amount) + Number(printingInvoice.transaction.discount_amount || 0)).toLocaleString()} {printingInvoice.transaction.currency}
                      </span>
                    </div>
                    {Number(printingInvoice.transaction.discount_amount) > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                        <span style={{ color: '#555' }}>{tr('Discount:')}</span>
                        <span style={{ color: '#ef4444', fontWeight: 'bold' }}>
                          - {Number(printingInvoice.transaction.discount_amount).toLocaleString()} {printingInvoice.transaction.currency}
                        </span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid #ddd', paddingTop: '10px' }}>
                      <span style={{ color: '#333', fontWeight: 'bold', fontSize: '18px' }}>{tr('Final Total:')}</span>
                      <span style={{ color: '#22c55e', fontWeight: 'bold', fontSize: '18px' }}>
                        {Number(printingInvoice.transaction.total_amount).toLocaleString()} {printingInvoice.transaction.currency}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Print Controls (Hidden on paper) */}
                <div className="no-print" style={{ marginTop: '40px', display: 'flex', gap: '10px', justifyContent: 'center' }}>
                  <button className="btn" onClick={() => window.print()} style={{ background: '#22c55e', color: 'black', padding: '10px 20px', borderRadius: '5px', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>Print / Save PDF</button>
                  <button className="btn" onClick={() => setInvoiceLang(invoiceLang === 'en' ? 'tr' : 'en')} style={{ background: 'var(--sale)', color: 'white', padding: '10px 20px', borderRadius: '5px', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
                    {invoiceLang === 'en' ? 'Translate to Turkish' : 'Translate to English'}
                  </button>
                  <button className="btn" onClick={() => setPrintingInvoice(null)} style={{ background: '#f87171', color: 'white', padding: '10px 20px', borderRadius: '5px', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>Close & Back</button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Modals Section */}

      {/* 1. Advanced Filters Modal */}
      {showFiltersModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ width: '90%', maxWidth: '500px', background: 'var(--card-bg)' }}>
            <div className="flex justify-between items-center mb-4 border-b pb-2">
              <h3 className="flex items-center gap-2"><Filter size={20} /> Filter Ledger</h3>
              <button onClick={() => setShowFiltersModal(false)} className="btn no-print" style={{ background: 'transparent', padding: '0.2rem' }}><X size={20} /></button>
            </div>
            
            <div className="form-group mb-3">
              <label>Search (Name or Description)</label>
              <input type="text" className="form-control" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search here..." />
            </div>

            <div className="flex gap-3 mb-3">
              <div className="form-group" style={{ flex: 1 }}>
                <label>Transaction Type</label>
                <select className="form-control" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                  <option value="all">All</option>
                  <option value="deposit">Income Deposit</option>
                  <option value="withdrawal">Cash Withdrawal</option>
                  <option value="sale">Sales</option>
                  <option value="purchase">Purchases</option>
                  <option value="expense">Expenses</option>
                </select>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Currency</label>
                <select className="form-control" value={filterCurrency} onChange={(e) => setFilterCurrency(e.target.value)}>
                  <option value="all">All</option>
                  <option value="USD">USD ($)</option>
                  <option value="TRY">TRY (TL)</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3 mb-4">
              <div className="form-group" style={{ flex: 1 }}>
                <label>From Date</label>
                <input type="date" className="form-control" value={filterStartDate} onChange={(e) => setFilterStartDate(e.target.value)} />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>To Date</label>
                <input type="date" className="form-control" value={filterEndDate} onChange={(e) => setFilterEndDate(e.target.value)} />
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={() => setShowFiltersModal(false)} className="btn btn-primary" style={{ flex: 2, background: 'var(--primary)', color: '#000' }}>Apply & Close</button>
              <button onClick={handleResetFilters} className="btn" style={{ flex: 1, background: 'var(--card-border)', color: 'var(--text-color)' }}>Reset</button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Quick Edit Modal */}
      {editingTransaction && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ width: '90%', maxWidth: '500px', background: 'var(--card-bg)' }}>
            <div className="flex justify-between items-center mb-4 border-b pb-2">
              <h3 className="flex items-center gap-2"><Edit size={20} /> Edit Transaction</h3>
              <button onClick={() => setEditingTransaction(null)} className="btn no-print" style={{ background: 'transparent', padding: '0.2rem' }}><X size={20} /></button>
            </div>
            
            <form onSubmit={handleSaveQuickEdit}>
              <div className="form-group mb-3">
                <label>Name / Entity</label>
                <input type="text" className="form-control" value={editForm.person} onChange={(e) => setEditForm({...editForm, person: e.target.value})} />
              </div>
              <div className="form-group mb-3">
                <label>Description</label>
                <input type="text" className="form-control" value={editForm.description} onChange={(e) => setEditForm({...editForm, description: e.target.value})} required />
              </div>
              
              {!(editingTransaction.type === 'sale' || editingTransaction.type === 'purchase') && (
                <div className="form-group mb-4">
                  <label>Total Amount</label>
                  <input type="number" className="form-control" value={editForm.amount} onChange={(e) => setEditForm({...editForm, amount: e.target.value})} step="0.01" dir="ltr" required />
                  <small className="text-muted mt-1 block">Changing the amount here will directly affect the balance.</small>
                </div>
              )}
              
              {(editingTransaction.type === 'sale' || editingTransaction.type === 'purchase') && (
                <div className="mb-4 p-2" style={{ background: 'var(--input-bg)', borderRadius: '4px' }}>
                  <small className="text-warning">Note: Invoice amounts (sale/purchase) cannot be edited to maintain inventory consistency. If there is an error, please delete the invoice and recreate it.</small>
                </div>
              )}

              <button type="submit" className="btn btn-primary" style={{ width: '100%', background: 'var(--warning)', color: '#000' }} disabled={submitting}>Save Edits</button>
            </form>
          </div>
        </div>
      )}

      {/* 3. View Details Modal */}
      {viewingTransaction && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ width: '90%', maxWidth: '600px', background: 'var(--card-bg)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="flex justify-between items-center mb-4 border-b pb-2">
              <h3 className="flex items-center gap-2"><Eye size={20} /> Invoice Details</h3>
              <button onClick={() => setViewingTransaction(null)} className="btn no-print" style={{ background: 'transparent', padding: '0.2rem' }}><X size={20} /></button>
            </div>
            
            <div className="mb-4">
              <p><strong>Entity:</strong> {viewingTransaction.transaction.person || 'Unspecified'}</p>
              <p><strong>Description:</strong> {viewingTransaction.transaction.description}</p>
              <p><strong>Date:</strong> {format(new Date(viewingTransaction.transaction.created_at), 'dd/MM/yyyy p')}</p>
              <p><strong>Currency:</strong> {viewingTransaction.transaction.currency === 'USD' ? 'USD ($)' : 'TRY (TL)'}</p>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ background: 'var(--input-bg)' }}>
                  <th style={{ padding: '8px', textAlign: 'right' }}>Item</th>
                  <th style={{ padding: '8px', textAlign: 'center' }}>Qty</th>
                  <th style={{ padding: '8px', textAlign: 'left' }}>Unit Price</th>
                  <th style={{ padding: '8px', textAlign: 'left' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {viewingTransaction.items.map((item, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--input-border)' }}>
                    <td style={{ padding: '8px' }}>{item.inventory_items?.name || 'Deleted Item'}</td>
                    <td style={{ padding: '8px', textAlign: 'center' }}>{item.quantity}</td>
                    <td style={{ padding: '8px', textAlign: 'left' }} dir="ltr">{Number(item.unit_price).toLocaleString()}</td>
                    <td style={{ padding: '8px', textAlign: 'left' }} dir="ltr">{(Number(item.quantity) * Number(item.unit_price)).toLocaleString()}</td>
                  </tr>
                ))}
                {viewingTransaction.items.length === 0 && (
                  <tr><td colSpan="4" style={{ padding: '8px', textAlign: 'center' }}>No items (or they were deleted)</td></tr>
                )}
              </tbody>
            </table>

            <div style={{ background: 'var(--input-bg)', padding: '1rem', borderRadius: '4px' }}>
              <div className="flex justify-between mb-1">
                <span>Discount Given:</span>
                <span className="text-danger" dir="ltr">{Number(viewingTransaction.transaction.discount_amount || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between font-bold" style={{ fontSize: '1.1rem' }}>
                <span>Final Total:</span>
                <span className="text-primary" dir="ltr">{Number(viewingTransaction.transaction.total_amount).toLocaleString()} {viewingTransaction.transaction.currency}</span>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* 4. Profit Reports Modal */}
      {showProfitModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ width: '90%', maxWidth: '600px', background: 'var(--card-bg)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="flex justify-between items-center mb-4 border-b pb-2">
              <h3 className="flex items-center gap-2"><TrendingUp size={20} className="text-primary" /> Profit & Loss Reports</h3>
              <button onClick={() => setShowProfitModal(false)} className="btn no-print" style={{ background: 'transparent', padding: '0.2rem' }}><X size={20} /></button>
            </div>
            
            <div className="flex gap-3 mb-4" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-group mb-0" style={{ flex: 1, minWidth: '150px' }}>
                <label>Timeframe</label>
                <select className="form-control" value={profitTimeframe} onChange={(e) => setProfitTimeframe(e.target.value)}>
                  <option value="month">Specific Month</option>
                  <option value="all">All Time</option>
                </select>
              </div>

              {profitTimeframe === 'month' && (
                <div className="form-group mb-0" style={{ flex: 1, minWidth: '150px' }}>
                  <label>Select Month</label>
                  <input type="month" className="form-control" value={profitMonth} onChange={(e) => setProfitMonth(e.target.value)} />
                </div>
              )}

              <button onClick={generateProfitReport} className="btn btn-primary mb-0" style={{ height: '42px', background: 'var(--primary)', color: '#000', padding: '0 1.5rem', flex: 1, minWidth: '150px' }} disabled={loadingProfit}>
                {loadingProfit ? 'Calculating...' : 'Generate Report'}
              </button>
            </div>

            {profitData && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ background: 'var(--input-bg)', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--input-border)' }}>
                  <h4 className="mb-3 text-muted text-center">Summary for {profitTimeframe === 'all' ? 'All Time' : `month ${profitMonth}`} (estimated in USD $)</h4>
                  
                  <div className="flex justify-between mb-2" style={{ borderBottom: '1px dashed var(--card-border)', paddingBottom: '0.5rem' }}>
                    <span>Total Sales Revenue ({profitData.salesCount} transactions):</span>
                    <span dir="ltr" className="text-primary font-bold">{profitData.totalSalesRevenueUsd.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} $</span>
                  </div>
                  
                  <div className="flex justify-between mb-2" style={{ borderBottom: '1px dashed var(--card-border)', paddingBottom: '0.5rem' }}>
                    <span>Cost of Goods Sold (COGS):</span>
                    <span dir="ltr" className="text-warning"> - {profitData.totalCogsUsd.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} $</span>
                  </div>

                  <div className="flex justify-between mb-3" style={{ borderBottom: '2px solid var(--card-border)', paddingBottom: '0.5rem' }}>
                    <span>Discounts Given on Sales:</span>
                    <span dir="ltr" className="text-danger font-bold"> {profitData.totalDiscountsUsd.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} $</span>
                  </div>

                  <div className="flex justify-between mb-4 font-bold text-lg" style={{ background: 'rgba(34, 197, 94, 0.1)', padding: '0.5rem', borderRadius: '4px' }}>
                    <span className="text-green">Gross Profit:</span>
                    <span dir="ltr" className="text-green">{profitData.grossProfitUsd.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} $</span>
                  </div>

                  <div className="flex justify-between mb-3" style={{ borderBottom: '2px solid var(--card-border)', paddingBottom: '0.5rem' }}>
                    <span>Total Expenses and Withdrawals ({profitData.expensesCount} transactions):</span>
                    <span dir="ltr" className="text-danger font-bold"> - {profitData.totalExpensesUsd.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} $</span>
                  </div>

                  <div className="flex justify-between font-bold text-xl p-3" style={{ background: profitData.netProfitUsd >= 0 ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)', borderRadius: '8px' }}>
                    <span className={profitData.netProfitUsd >= 0 ? "text-green" : "text-danger"}>Final Net Profit:</span>
                    <span dir="ltr" className={profitData.netProfitUsd >= 0 ? "text-green" : "text-danger"}>{profitData.netProfitUsd.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} $</span>
                  </div>
                  
                  <div className="mt-4 text-xs text-muted text-center">
                    Note: This report relies on stored (historical) cost of items at the time of sale. If older invoices do not have historical cost recorded, COGS will appear as 0.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Add Product Modal */}
      {showAddProductModal && (
        <div className="modal" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-content" style={{ maxWidth: '500px', width: '100%', margin: '0 1rem' }}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="m-0 text-primary flex items-center gap-2"><Package size={20} /> Add New Product</h3>
              <button onClick={() => setShowAddProductModal(false)} className="btn no-print" style={{ background: 'transparent', padding: '0.2rem' }}><X size={20} /></button>
            </div>
            <form onSubmit={handleAddProduct}>
              <div className="form-group mb-4">
                <label>Product Name</label>
                <input 
                  type="text" 
                  className="form-control" 
                  value={newProductName} 
                  onChange={(e) => setNewProductName(e.target.value)} 
                  placeholder="Enter product name"
                  autoFocus
                />
              </div>
              <button type="submit" className="btn" style={{ width: '100%', background: 'var(--primary)', color: '#000' }} disabled={submitting}>
                {submitting ? 'Adding...' : 'Add Product'}
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
