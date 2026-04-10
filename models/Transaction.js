const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  buyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  // مبالغ المعاملة
  amount: { type: Number, required: true },           // إجمالي المبلغ
  platformCommission: { type: Number, required: true }, // عمولة المنصة
  sellerAmount: { type: Number, required: true },      // صافي البائع
  
  // حالة المعاملة
  status: { 
    type: String, 
    enum: ['pending', 'completed', 'failed', 'refunded', 'held'], 
    default: 'pending' 
  },
  
  // طريقة الدفع
  paymentMethod: { type: String, enum: ['cash', 'card', 'paypal', 'wallet'], required: true },
  
  // تاريخ الاستحقاق (للدفع المؤجل)
  releaseDate: { type: Date, default: () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) }, // 14 يوم
  
  // تاريخ الدفع الفعلي
  paidAt: { type: Date },
  
  payoutMethodId: { type: mongoose.Schema.Types.ObjectId, ref: 'PayoutMethod' },
  
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Transaction', transactionSchema);