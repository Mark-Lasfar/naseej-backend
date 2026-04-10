const mongoose = require('mongoose');

const storeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  description: { type: String, default: '' },
  logo: { type: String, default: '' },
  coverImage: { type: String, default: '' },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  settings: {
    isActive: { type: Boolean, default: true },
    isVerified: { type: Boolean, default: false },
    allowReviews: { type: Boolean, default: true },
    commissionRate: { type: Number, default: 10 },
    minimumOrderAmount: { type: Number, default: 0 },
    freeShippingThreshold: { type: Number, default: 1000 }
  },
  stats: {
    totalProducts: { type: Number, default: 0 },
    totalSales: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 },
    totalReviews: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
    followers: { type: Number, default: 0 }
  },
  contact: {
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    address: { type: String, default: '' },
    city: { type: String, default: '' },
    country: { type: String, default: 'Egypt' }
  },

  // داخل storeSchema
  paymentSettings: {
    // إعدادات استلام المدفوعات
    autoReleaseDays: { type: Number, default: 14 }, // كم يوم حتى تحرير المبلغ
    minimumPayout: { type: Number, default: 500 }, // الحد الأدنى للسحب
    holdPercentage: { type: Number, default: 0 }, // نسبة محتجزة للضمان

    // إعدادات الدفع للعملاء
    acceptedPaymentMethods: [{
      type: { type: String, enum: ['cash', 'card', 'paypal', 'vodafone_cash', 'instapay', 'fawry'] },
      isActive: { type: Boolean, default: true }
    }],

    // إعدادات الشحن
    shippingMethods: [{
      name: { type: String },
      cost: { type: Number },
      estimatedDays: { type: Number }
    }]
  },
  socialLinks: {
    facebook: { type: String, default: '' },
    instagram: { type: String, default: '' },
    twitter: { type: String, default: '' },
    whatsapp: { type: String, default: '' }
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

storeSchema.pre('save', function (next) {
  if (this.isModified('name')) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9\u0621-\u064A]+/g, '-')
      .replace(/^-|-$/g, '');
  }
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Store', storeSchema);