const mongoose = require('mongoose');

const payoutMethodSchema = new mongoose.Schema({
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  isDefault: { type: Boolean, default: false },
  
  // نوع طريقة الدفع
  type: { 
    type: String, 
    enum: ['bank', 'paypal', 'vodafone_cash', 'instapay', 'fawry'], 
    required: true 
  },
  
  // بيانات الحساب البنكي
  bankDetails: {
    bankName: { type: String, default: '' },
    accountName: { type: String, default: '' },
    accountNumber: { type: String, default: '' },
    iban: { type: String, default: '' },
    swiftCode: { type: String, default: '' }
  },
  
  // PayPal
  paypalDetails: {
    email: { type: String, default: '' }
  },
  
  // Vodafone Cash / InstaPay
  mobileWalletDetails: {
    phoneNumber: { type: String, default: '' },
    provider: { type: String, enum: ['vodafone', 'instapay', 'orange', 'etisalat'], default: 'vodafone' }
  },
  
  // Fawry
  fawryDetails: {
    merchantCode: { type: String, default: '' },
    securityKey: { type: String, default: '' }
  },
  
  status: { type: String, enum: ['pending', 'active', 'rejected', 'inactive'], default: 'pending' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('PayoutMethod', payoutMethodSchema);