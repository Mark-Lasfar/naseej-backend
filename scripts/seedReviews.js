// backend/scripts/seedReviews.js
require('dotenv').config();
const mongoose = require('mongoose');

// استيراد الموديلات من server.js
const { Product, Review, User } = require('../server');

if (!process.env.MONGODB_URI) {
    console.error('❌ MONGODB_URI is not defined');
    process.exit(1);
}
const MONGODB_URI = process.env.MONGODB_URI;

// نصوص تقييمات جاهزة (ستُستخدم عشوائيًا)
const reviewTexts = [
    "منتج رائع جداً، أنصح به بشدة!",
    "جودة ممتازة وسعر مناسب جداً.",
    "تسليم سريع ومنتج كما هو موضح في الصورة.",
    "خامة ممتازة وألوان جميلة، سعيد جداً بالشراء.",
    "المنتج أفضل مما توقعت، شكراً لكم.",
    "تسوق ممتع وسهل، سأكرر التجربة بالتأكيد.",
    "جودة عالية وأنصح بالتعامل معكم.",
    "المنتج جميل لكن السعر مرتفع قليلاً مقارنة بغيره.",
    "خامة ممتازة وأنصح بها بشدة.",
    "تجربة شراء ممتازة وسريعة.",
    "السجاد فاخر جداً ويليق بالمنزل، أنصح به.",
    "القماش ناعم جداً وجودته عالية، شكراً."
];

// دالة لجلب رقم عشوائي بين قيمة min و max (ضمنًا)
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function seedReviews() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        // 1. حذف جميع التقييمات القديمة (للتأكد من البدء من نقطة نظيفة)
        console.log('🗑️ Clearing existing reviews...');
        await Review.deleteMany({});
        console.log('✅ Cleared old reviews');

        // 2. جلب جميع المنتجات
        const products = await Product.find();
        // 3. جلب جميع المستخدمين العاديين (customers) - سنستخدمهم كمراجعين
        const users = await User.find({ role: 'customer' });

        if (products.length === 0) {
            console.log('⚠️ No products found. Please run seed.js first.');
            return;
        }
        if (users.length === 0) {
            console.log('⚠️ No customers found. Please run seed.js first.');
            return;
        }

        console.log(`📝 Generating reviews for ${products.length} products...`);
        const allReviews = [];

        for (const product of products) {
            // عدد التقييمات لكل منتج: بين 5 و 20 تقييمًا
            const numberOfReviews = randomInt(5, 20);
            // اختيار مجموعة عشوائية من المستخدمين لتقييم هذا المنتج
            const shuffledUsers = [...users];
            for (let i = shuffledUsers.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffledUsers[i], shuffledUsers[j]] = [shuffledUsers[j], shuffledUsers[i]];
            }
            const reviewers = shuffledUsers.slice(0, numberOfReviews);

            for (const user of reviewers) {
                const rating = randomInt(1, 5); // تقييم بين 1 و 5 نجوم
                const randomReviewText = reviewTexts[Math.floor(Math.random() * reviewTexts.length)];
                const review = {
                    productId: product._id,
                    userId: user._id,
                    rating: rating,
                    text: randomReviewText,
                    timestamp: new Date(Date.now() - randomInt(0, 60 * 24 * 60 * 60 * 1000)) // تاريخ عشوائي خلال الـ 60 يومًا الماضية
                };
                allReviews.push(review);
            }
        }

        if (allReviews.length > 0) {
            await Review.insertMany(allReviews);
            console.log(`✅ ${allReviews.length} reviews generated and added to the database.`);
        } else {
            console.log('⚠️ No reviews were generated.');
        }

        // 4. (اختياري) تحديث متوسط التقييمات (rating) وعدد التقييمات (reviewCount) في كل منتج
        console.log('🔄 Updating product ratings...');
        for (const product of products) {
            const productReviews = await Review.find({ productId: product._id });
            if (productReviews.length > 0) {
                const avgRating = productReviews.reduce((sum, r) => sum + r.rating, 0) / productReviews.length;
                product.rating = Math.round(avgRating * 10) / 10; // تقريب لأقرب 0.1
                product.reviewCount = productReviews.length;
                await product.save();
            }
        }
        console.log('✅ Product ratings updated.');

        console.log('\n🎉 Review seeding completed successfully!');
        console.log('====================================');
        console.log(`   - Total Reviews Added: ${allReviews.length}`);
        console.log(`   - Total Products Updated: ${products.length}`);
        console.log('====================================');

    } catch (error) {
        console.error('❌ Seeding reviews error:', error);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB');
    }
}

seedReviews();