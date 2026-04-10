// backend/scripts/seed.js
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ✅ استورد الموديلات من server.js
const { User, Product, Customer, Coupon, ShippingRate } = require('../server');

if (!process.env.MONGODB_URI) {
  console.error('❌ MONGODB_URI is not defined');
  process.exit(1);
}
const MONGODB_URI = process.env.MONGODB_URI;


// المنتجات (بدون slug - هنضيفه في الكود)
const products = [
  {
    name: "سجاد صوف فاخر - بيج",
    slug: "سجاد-صوف-فاخر-بيج",
    category: "carpet",
    subcategory: "wool",
    material: "صوف طبيعي 100%",
    size: "200x300 سم",
    color: "بيج فاتح",
    price: 2500,
    oldPrice: 3500,
    quantity: 50,
    imageUrl: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR47nEBR3-0a8nroyXdIhqcI_BJ-LPINhAPDw&s",
    description: "سجاد صوف طبيعي فاخر مصنوع يدوياً",
    features: ["صوف طبيعي 100%", "مقاوم للبقع", "سهل التنظيف"],
    tags: ["سجاد", "صوف", "فاخر", "بيج"],
    isFeatured: true,
    isNew: true,
    discount: 28,
    inStock: true,
    rating: 4.8,
    reviewCount: 15
  },
  {
    name: "سجاد حرير - رمادي غامق",
    slug: "سجاد-حرير-رمادي-غامق",
    category: "carpet",
    subcategory: "silk",
    material: "حرير طبيعي",
    size: "160x230 سم",
    color: "رمادي غامق",
    price: 4500,
    oldPrice: 6000,
    quantity: 30,
    imageUrl: "https://cdn.arabsstock.com/uploads/images/336092/saudi-design-for-colorful-authentic-thumbnail-336092.webp",
    description: "سجاد حرير فاخر بتصميم عصري",
    features: ["حرير طبيعي", "تصميم عصري", "لمعة طبيعية"],
    tags: ["سجاد", "حرير", "رمادي", "فاخر"],
    isFeatured: true,
    isNew: false,
    discount: 25,
    inStock: true,
    rating: 4.9,
    reviewCount: 23
  },
  {
    name: "موكيت قطيفة - بيج فاتح",
    slug: "موكيت-قطيفة-بيج-فاتح",
    category: "carpet",
    subcategory: "velvet",
    material: "قطيفة",
    size: "250x350 سم",
    color: "بيج فاتح",
    price: 1800,
    oldPrice: 2200,
    quantity: 100,
    imageUrl: "https://cdn.arabsstock.com/uploads/images/255073/the-popular-saudi-heritage-of-thumbnail-255073.webp",
    description: "موكيت قطيفة ناعم جداً",
    features: ["قطيفة عالية الجودة", "ناعم جداً", "مضاد للحساسية"],
    tags: ["موكيت", "قطيفة", "بيج", "غرفة نوم"],
    isFeatured: false,
    isNew: true,
    discount: 18,
    inStock: true,
    rating: 4.5,
    reviewCount: 8
  },
  {
    name: "سجاد عربي تقليدي - أحمر",
    slug: "سجاد-عربي-تقليدي-أحمر",
    category: "carpet",
    subcategory: "traditional",
    material: "صوف + قطن",
    size: "300x400 سم",
    color: "أحمر",
    price: 5800,
    oldPrice: 7500,
    quantity: 15,
    imageUrl: "https://cdn.arabsstock.com/uploads/images/255057/traditional-handicraft-heritage-art-popular-thumbnail-255057.webp",
    description: "سجاد عربي تقليدي مصنوع يدوياً",
    features: ["صناعة يدوية", "نقوش أثرية", "ألوان طبيعية"],
    tags: ["سجاد", "عربي", "تقليدي", "أحمر"],
    isFeatured: true,
    isNew: false,
    discount: 22,
    inStock: true,
    rating: 4.7,
    reviewCount: 12
  },
  {
    name: "قماش ستائر - كتاني بيج",
    slug: "قماش-ستائر-كتاني-بيج",
    category: "textile",
    subcategory: "linen",
    material: "كتان طبيعي",
    size: "140 سم عرض",
    color: "بيج طبيعي",
    price: 350,
    oldPrice: 500,
    quantity: 200,
    imageUrl: "https://cdn.arabsstock.com/uploads/images/255046/the-popular-saudi-heritage-of-preview-255046.jpg",
    description: "قماش ستائر كتاني طبيعي",
    features: ["كتان طبيعي", "قابل للتنفس", "مضاد للبكتيريا"],
    tags: ["قماش", "ستائر", "كتان", "بيج"],
    isFeatured: false,
    isNew: true,
    discount: 30,
    inStock: true,
    rating: 4.6,
    reviewCount: 7
  },
  {
    name: "قماش تنجيد - مخمل أزرق",
    slug: "قماش-تنجيد-مخمل-أزرق",
    category: "textile",
    subcategory: "velvet",
    material: "مخمل",
    size: "150 سم عرض",
    color: "أزرق داكن",
    price: 450,
    oldPrice: 650,
    quantity: 150,
    imageUrl: "https://cdn.arabsstock.com/uploads/images/255050/popular-designs-for-colorful-authentic-preview-255050.jpg",
    description: "قماش تنجيد مخمل فاخر",
    features: ["مخمل عالي الجودة", "لمعة طبيعية", "مقاوم للاهتراء"],
    tags: ["قماش", "تنجيد", "مخمل", "أزرق"],
    isFeatured: true,
    isNew: false,
    discount: 30,
    inStock: true,
    rating: 4.8,
    reviewCount: 11
  },
  {
    name: "سجاد صوف - بيج غامق",
    slug: "سجاد-صوف-بيج-غامق",
    category: "carpet",
    subcategory: "wool",
    material: "صوف طبيعي",
    size: "180x270 سم",
    color: "بيج غامق",
    price: 2200,
    oldPrice: 3000,
    quantity: 40,
    imageUrl: "https://cdn.arabsstock.com/uploads/images/255042/traditional-handicraft-heritage-art-popular-designs-colorful.jpg",
    description: "سجاد صوف طبيعي بتصميم كلاسيكي",
    features: ["صوف طبيعي", "تصميم كلاسيكي", "متين"],
    tags: ["سجاد", "صوف", "كلاسيكي", "بيج"],
    isFeatured: false,
    isNew: false,
    discount: 26,
    inStock: true,
    rating: 4.4,
    reviewCount: 9
  },
  {
    name: "قماش تنجيد - قطيفة وردي",
    slug: "قماش-تنجيد-قطيفة-وردي",
    category: "textile",
    subcategory: "velvet",
    material: "قطيفة",
    size: "140 سم عرض",
    color: "وردي فاتح",
    price: 380,
    oldPrice: 550,
    quantity: 120,
    imageUrl: "https://cdn.arabsstock.com/uploads/images/336062/traditional-craft-art-saudi-design-authentic-colorful-arabic.jpg",
    description: "قماش تنجيد قطيفة ناعم",
    features: ["قطيفة ناعمة", "ألوان عصرية", "مقاوم للبقع"],
    tags: ["قماش", "تنجيد", "قطيفة", "وردي"],
    isFeatured: false,
    isNew: true,
    discount: 30,
    inStock: true,
    rating: 4.7,
    reviewCount: 6
  }
];
// العملاء (30 عميل)
const customers = [];
const firstNames = ['أحمد', 'محمد', 'علي', 'حسن', 'حسين', 'محمود', 'إبراهيم', 'يوسف', 'عمر', 'خالد', 'مصطفى', 'عبدالله', 'كريم', 'طارق', 'سامي'];
const lastNames = ['حسن', 'علي', 'محمود', 'إبراهيم', 'يوسف', 'عمر', 'خالد', 'مصطفى', 'عبدالله', 'كريم', 'طارق', 'سامي', 'فاروق', 'ممدوح', 'عاطف'];
const cities = ['Cairo', 'Alexandria', 'Giza', 'Mansoura', 'Tanta', 'Port Said', 'Suez', 'Luxor', 'Aswan', 'Ismailia'];

for (let i = 0; i < 30; i++) {
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
  customers.push({
    name: `${firstName} ${lastName}`,
    phone: `010${Math.floor(Math.random() * 90000000) + 10000000}`,
    address: `${Math.floor(Math.random() * 200) + 1} شارع ${firstName}، ${cities[Math.floor(Math.random() * cities.length)]}`,
    email: `${firstName}.${lastName}${Math.floor(Math.random() * 1000)}@example.com`,
    registeredAt: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000)
  });
}

// كوبونات خصم
const coupons = [
  { code: 'WELCOME10', discountType: 'percentage', discountValue: 10, minOrderAmount: 200, maxDiscount: 500, validFrom: new Date(), validTo: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), usageLimit: 100, isActive: true },
  { code: 'SAVE20', discountType: 'percentage', discountValue: 20, minOrderAmount: 500, maxDiscount: 1000, validFrom: new Date(), validTo: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000), usageLimit: 50, isActive: true },
  { code: 'FLAT100', discountType: 'fixed', discountValue: 100, minOrderAmount: 1000, maxDiscount: 100, validFrom: new Date(), validTo: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), usageLimit: 30, isActive: true },
  { code: 'FREESHIP', discountType: 'percentage', discountValue: 0, minOrderAmount: 1000, maxDiscount: 0, validFrom: new Date(), validTo: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), usageLimit: 200, isActive: true },
  { code: 'SUMMER25', discountType: 'percentage', discountValue: 25, minOrderAmount: 800, maxDiscount: 1500, validFrom: new Date(), validTo: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000), usageLimit: 40, isActive: true }
];

// أسعار الشحن
const shippingRates = [
  { city: 'Cairo', cost: 50, estimatedDays: 2 },
  { city: 'Alexandria', cost: 60, estimatedDays: 3 },
  { city: 'Giza', cost: 50, estimatedDays: 2 },
  { city: 'Mansoura', cost: 55, estimatedDays: 3 },
  { city: 'Tanta', cost: 55, estimatedDays: 3 },
  { city: 'Port Said', cost: 65, estimatedDays: 4 },
  { city: 'Suez', cost: 65, estimatedDays: 4 },
  { city: 'Luxor', cost: 80, estimatedDays: 5 },
  { city: 'Aswan', cost: 85, estimatedDays: 5 },
  { city: 'Ismailia', cost: 60, estimatedDays: 3 },
  { city: 'Other', cost: 100, estimatedDays: 7 }
];

async function seedDatabase() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    console.log('🗑️ Clearing existing data...');
    await Product.deleteMany({});
    await Customer.deleteMany({});
    await Coupon.deleteMany({});
    await ShippingRate.deleteMany({});
    await User.deleteMany({});
    console.log('✅ Cleared old data');

    console.log('👑 Creating admin user...');
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await User.create({
      username: 'admin',
      email: 'admin@naseej.com',
      password: hashedPassword,
      role: 'admin',
      phone: '01000000000'
    });
    console.log('✅ Admin created (admin@naseej.com / admin123)');

    console.log('👥 Creating customers...');
    const createdCustomers = [];
    for (const customer of customers) {
      const hashedUserPassword = await bcrypt.hash('customer123', 10);
      const user = await User.create({
        username: customer.email.split('@')[0],
        email: customer.email,
        password: hashedUserPassword,
        role: 'customer',
        phone: customer.phone
      });
      const newCustomer = await Customer.create({
        ...customer,
        userId: user._id
      });
      createdCustomers.push(newCustomer);
    }
    console.log(`✅ ${createdCustomers.length} customers created`);

    console.log('📦 Creating products...');
    const createdProducts = await Product.insertMany(products); // ✅ أسهل بكتير!
    console.log(`✅ ${createdProducts.length} products created`);

    console.log('🎫 Creating coupons...');
    const createdCoupons = await Coupon.insertMany(coupons);
    console.log(`✅ ${createdCoupons.length} coupons created`);

    console.log('🚚 Creating shipping rates...');
    const createdShippingRates = await ShippingRate.insertMany(shippingRates);
    console.log(`✅ ${createdShippingRates.length} shipping rates created`);

    console.log('\n🎉 Seeding completed successfully!');
    console.log('====================================');
    console.log(`   - Admin: admin@naseej.com / admin123`);
    console.log(`   - Customers: ${createdCustomers.length} (password: customer123)`);
    console.log(`   - Products: ${createdProducts.length}`);
    console.log(`   - Coupons: ${createdCoupons.length}`);
    console.log(`   - Shipping Rates: ${createdShippingRates.length}`);
    console.log('====================================');

  } catch (error) {
    console.error('❌ Seeding error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}


seedDatabase();