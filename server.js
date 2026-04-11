const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');



const axios = require('axios');
const mqtt = require('mqtt');
const net = require('net');
const { SerialPort } = require('serialport');

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Force load .env
dotenv.config({ path: __dirname + '/.env' });

// Models
const Store = require('./models/Store');
const PayoutMethod = require('./models/PayoutMethod');
const Transaction = require('./models/Transaction');

// Payment Gateways
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paypal = require('@paypal/checkout-server-sdk');

console.log('STRIPE_SECRET_KEY exists:', !!process.env.STRIPE_SECRET_KEY);
console.log('PAYPAL_CLIENT_ID exists:', !!process.env.PAYPAL_CLIENT_ID);

const app = express();
const PORT = process.env.PORT || 7860;

// PayPal Client
let paypalClient;
if (process.env.PAYPAL_MODE === 'sandbox') {
  paypalClient = new paypal.core.PayPalHttpClient(
    new paypal.core.SandboxEnvironment(
      process.env.PAYPAL_CLIENT_ID,
      process.env.PAYPAL_CLIENT_SECRET
    )
  );
} else if (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) {
  paypalClient = new paypal.core.PayPalHttpClient(
    new paypal.core.LiveEnvironment(
      process.env.PAYPAL_CLIENT_ID,
      process.env.PAYPAL_CLIENT_SECRET
    )
  );
}

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5000', 'https://naseej-system.vercel.app', process.env.FRONTEND_URL],
  credentials: true
}));
app.use(express.json());
app.use(morgan('dev'));





// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure Multer with Cloudinary storage
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const isImage = file.mimetype.startsWith('image/');
    const isVideo = file.mimetype.startsWith('video/');
    
    let resourceType = 'auto';
    let folder = 'naseej/products';
    let transformation = [];
    
    if (isImage) {
      resourceType = 'image';
      transformation = [
        { quality: 'auto' },
        { fetch_format: 'auto' },
        { width: 1200, height: 1200, crop: 'limit' }
      ];
    } else if (isVideo) {
      resourceType = 'video';
      transformation = [{ quality: 'auto' }];
    }
    
    return {
      folder: folder,
      allowed_formats: isImage ? ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'] : ['mp4', 'webm', 'mov'],
      resource_type: resourceType,
      transformation: transformation,
      public_id: `${Date.now()}-${Math.round(Math.random() * 1e9)}`
    };
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit for videos
  }
});
// MongoDB Connection
if (!process.env.MONGODB_URI) {
  console.error('❌ MONGODB_URI is not defined in environment variables');
  process.exit(1);
}

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// ================ Models ================

// User Model
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'seller', 'customer'], default: 'customer' },
  phone: { type: String, default: '' },
  followingStores: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: [] }], // ← أضف هذا السطر

  address: { type: String, default: '' },
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null },
  canSell: { type: Boolean, default: false },
  wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: [] }],
  createdAt: { type: Date, default: Date.now },



  lastSeen: { type: Date, default: Date.now },
  isOnline: { type: Boolean, default: false }
});
const User = mongoose.model('User', userSchema);

// Product Model
const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['active', 'pending', 'rejected', 'inactive'], default: 'pending' },
  slug: { type: String, required: true, unique: true },
  category: { type: String, enum: ['carpet', 'textile'], required: true },
  subcategory: { type: String, default: '' },
  material: { type: String, default: '' },
  size: { type: String, default: '' },
  color: { type: String, default: '' },
  price: { type: Number, required: true },
  oldPrice: { type: Number, default: 0 },
  quantity: { type: Number, default: 0 },
  imageUrl: { type: String, default: '' },
  images: [{ type: String, default: [] }],
  description: { type: String, default: '' },
  features: [{ type: String, default: [] }],
  tags: [{ type: String, default: [] }],
  rating: { type: Number, default: 0 },
  reviewCount: { type: Number, default: 0 },
  views: { type: Number, default: 0 },
  soldCount: { type: Number, default: 0 },
  isFeatured: { type: Boolean, default: false },
  isNew: { type: Boolean, default: false },
  discount: { type: Number, default: 0 },
  inStock: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

productSchema.pre('save', function(next) {
  if (this.isModified('name')) {
    const storePrefix = this.storeId ? this.storeId.toString().slice(-6) : '';
    this.slug = `${storePrefix}-${this.name
      .toLowerCase()
      .replace(/[^a-z0-9\u0621-\u064A]+/g, '-')
      .replace(/^-|-$/g, '')}`;
  }
  this.updatedAt = Date.now();
  this.inStock = this.quantity > 0;
  next();
});

const Product = mongoose.model('Product', productSchema);

// Review Model
const reviewSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});
const Review = mongoose.model('Review', reviewSchema);

// Customer Model
const customerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
  address: { type: String, default: '' },
  email: { type: String, default: '' },
  registeredAt: { type: Date, default: Date.now }
});
const Customer = mongoose.model('Customer', customerSchema);

// Invoice Model
const invoiceItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  quantity: { type: Number, required: true },
  unitPrice: { type: Number, required: true },
  subtotal: { type: Number, required: true }
});

const invoiceSchema = new mongoose.Schema({
  invoiceNumber: { type: String, required: true, unique: true },
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  items: [invoiceItemSchema],
  totalAmount: { type: Number, required: true },
  status: { type: String, enum: ['paid', 'unpaid', 'cancelled'], default: 'unpaid' },
  date: { type: Date, default: Date.now }
});
const Invoice = mongoose.model('Invoice', invoiceSchema);

// Coupon Model
const couponSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  discountType: { type: String, enum: ['percentage', 'fixed'], default: 'percentage' },
  discountValue: { type: Number, required: true },
  minOrderAmount: { type: Number, default: 0 },
  maxDiscount: { type: Number, default: 0 },
  validFrom: Date,
  validTo: Date,
  usageLimit: { type: Number, default: 1 },
  usedCount: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true }
});
const Coupon = mongoose.model('Coupon', couponSchema);

// ShippingRate Model
const shippingRateSchema = new mongoose.Schema({
  city: { type: String, required: true },
  district: String,
  cost: { type: Number, required: true },
  estimatedDays: { type: Number, default: 3 },
  isActive: { type: Boolean, default: true }
});
const ShippingRate = mongoose.model('ShippingRate', shippingRateSchema);

// Order Model
const orderItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  name: String,
  quantity: Number,
  unitPrice: Number,
  subtotal: Number,
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
   paymentMethod: { type: String, default: 'cash' }
});

const trackingHistorySchema = new mongoose.Schema({
  status: String,
  location: String,
  timestamp: { type: Date, default: Date.now },
  note: String
});

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  items: [orderItemSchema],
  shippingAddress: {
    street: String,
    city: String,
    district: String,
    phone: String,
    notes: String,
    email: String
  },
  shippingCost: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  couponCode: { type: String, default: '' },
  subtotal: { type: Number, required: true },
  totalAmount: { type: Number, required: true },


   paymentMethod: { 
    type: String, 
    enum: ['cash', 'paypal', 'card', 'bank', 'vodafone_cash', 'instapay', 'fawry'], 
    default: 'cash' 
  },

    paymentDetails: {
    method: String,
    merchantPhone: String,
    bankDetails: Object,
    status: String,
    transactionId: String,
    requestedAt: Date,
    paidAt: Date
  },


  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
  orderStatus: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned', 'refunded'],
    default: 'pending'
  },
  trackingNumber: { type: String, default: '' },
  trackingHistory: [trackingHistorySchema],
  paypalOrderId: { type: String, default: '' },
  paypalCaptureId: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  deliveredAt: Date,
  cancelledAt: Date
});
const Order = mongoose.model('Order', orderSchema);



// ================ AI Design Models ================

// Design Model - تخزين التصاميم
const designSchema = new mongoose.Schema({
  name: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  dimensions: {
    width: { type: Number, required: true }, // cm
    height: { type: Number, required: true }, // cm
    unit: { type: String, default: 'cm' }
  },
  colors: {
    primary: { type: String, required: true },
    secondary: [{ type: String }],
    accent: [{ type: String }]
  },
  pattern: {
    type: { type: String, enum: ['geometric', 'floral', 'abstract', 'custom', 'traditional'], default: 'geometric' },
    complexity: { type: Number, min: 1, max: 10, default: 5 },
    customSvg: { type: String, default: '' }
  },
  material: {
    type: { type: String, enum: ['wool', 'silk', 'cotton', 'polyester', 'blend'], required: true },
    density: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    thickness: { type: Number, default: 1.5 },
    weightPerSquareMeter: { type: Number, default: 2.5 }
  },
  aiGenerated: { type: Boolean, default: false },
  aiPrompt: { type: String, default: '' },
  previewUrl: { type: String, default: '' },
  preview3D: {
    type: { type: String, default: 'simple' },
    data: { type: Object, default: {} }
  },
  costEstimate: {
    materials: { type: Number, default: 0 },
    labor: { type: Number, default: 0 },
    total: { type: Number, default: 0 }
  },
  productionTime: { type: Number, default: 0 },
  gcode: { type: String, default: '' },
  status: { type: String, enum: ['draft', 'approved', 'production', 'completed', 'cancelled'], default: 'draft' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
const Design = mongoose.model('Design', designSchema);

// Material Library Model
const materialSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  category: { type: String, enum: ['wool', 'silk', 'cotton', 'polyester', 'blend'], required: true },
  supplier: { type: String, required: true },
  pricePerKg: { type: Number, required: true },
  pricePerMeter: { type: Number, default: 0 },
  availableColors: [{ type: String }],
  availableQuantities: { type: Number, default: 0 },
  thickness: { type: Number, default: 1.5 },
  weight: { type: Number, default: 2.5 },
  durability: { type: Number, min: 1, max: 10, default: 5 },
  softness: { type: Number, min: 1, max: 10, default: 5 },
  imageUrl: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});
const Material = mongoose.model('Material', materialSchema);

// Pattern Library Model
const patternSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  category: { type: String, enum: ['geometric', 'floral', 'abstract', 'traditional', 'custom'], required: true },
  complexity: { type: Number, min: 1, max: 10, default: 5 },
  svgData: { type: String, required: true },
  thumbnailUrl: { type: String, default: '' },
  previewUrl: { type: String, default: '' },
  tags: [{ type: String }],
  isPublic: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  usageCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const Pattern = mongoose.model('Pattern', patternSchema);

// Machine Profile Model
const machineSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, enum: ['cnc_loom', 'jacquard', 'tufting', 'weaving'], required: true },
  ipAddress: { type: String, required: true },
  port: { type: Number, default: 502 },
  protocol: { type: String, enum: ['TCP', 'Serial', 'MQTT'], default: 'TCP' },
  status: { type: String, enum: ['online', 'offline', 'busy', 'maintenance'], default: 'offline' },
  lastConnection: { type: Date },
  capabilities: {
    maxWidth: { type: Number, default: 400 },
    maxHeight: { type: Number, default: 400 },
    supportedMaterials: [{ type: String }],
    supportedPatterns: [{ type: String }]
  },
  isActive: { type: Boolean, default: true }
});
const Machine = mongoose.model('Machine', machineSchema);


// Production Log Model
const productionLogSchema = new mongoose.Schema({
  designId: { type: mongoose.Schema.Types.ObjectId, ref: 'Design', required: true },
  machineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Machine', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['started', 'in_progress', 'completed', 'failed'], default: 'started' },
  progress: { type: Number, default: 0 },
  details: { type: Object, default: {} },
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date }
});
const ProductionLog = mongoose.model('ProductionLog', productionLogSchema);


// ================ Social Posts Models ================

// Post Model - المنشورات
const postSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null },
  content: { type: String, required: true },
  media: [{
    type: { type: String, enum: ['image', 'video', 'audio'], default: 'image' },
    url: { type: String, required: true },
    thumbnail: { type: String, default: '' }
  }],
  hashtags: [{ type: String }],
  mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  
  // تفاعلات
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  likesCount: { type: Number, default: 0 },
  commentsCount: { type: Number, default: 0 },
  sharesCount: { type: Number, default: 0 },
  viewsCount: { type: Number, default: 0 },
  
  // إعدادات النشر
  visibility: { 
    type: String, 
    enum: ['public', 'followers', 'private', 'store_only'], 
    default: 'public' 
  },
  isScheduled: { type: Boolean, default: false },
  scheduledAt: { type: Date, default: null },
  isPinned: { type: Boolean, default: false },
  
  // حالة المنشور
  status: { type: String, enum: ['published', 'draft', 'archived', 'reported'], default: 'published' },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
const Post = mongoose.model('Post', postSchema);

// Comment Model - التعليقات
const commentSchema = new mongoose.Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null }, // للردود
  content: { type: String, required: true },
  media: { type: String, default: '' },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  likesCount: { type: Number, default: 0 },
  status: { type: String, enum: ['published', 'hidden', 'reported'], default: 'published' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
const Comment = mongoose.model('Comment', commentSchema);

// Notification Model - الإشعارات
const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { 
    type: String, 
    enum: ['like', 'comment', 'share', 'follow', 'mention', 'post_approved', 'payment_received'], 
    required: true 
  },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null },
  commentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
  content: { type: String, required: true },
  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Notification = mongoose.model('Notification', notificationSchema);

// Story Model - القصص (مثل ستوري انستجرام)
const storySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null },
  media: {
    type: { type: String, enum: ['image', 'video'], required: true },
    url: { type: String, required: true }
  },
  duration: { type: Number, default: 24 }, // ساعات
  views: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  viewsCount: { type: Number, default: 0 },
  reactions: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    emoji: { type: String, default: '❤️' }
  }],
  expiresAt: { type: Date, default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) },
  createdAt: { type: Date, default: Date.now }
});
const Story = mongoose.model('Story', storySchema);



// ================ Chat Models ================

// Conversation Model - المحادثة بين مستخدمين
const conversationSchema = new mongoose.Schema({
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
  participantsDetails: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastReadAt: { type: Date, default: Date.now },
    isTyping: { type: Boolean, default: false },
    typingAt: { type: Date, default: null }
  }],
  lastMessage: {
    text: { type: String, default: '' },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    sentAt: { type: Date, default: Date.now },
    isRead: { type: Boolean, default: false },
    type: { type: String, enum: ['text', 'image', 'file'], default: 'text' },
    mediaUrl: { type: String, default: '' }
  },
  settings: {
  isPinned: { type: Boolean, default: false },
  isMuted: { type: Boolean, default: false }
  },
  unreadCount: { type: Number, default: 0 },
  isArchived: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
const Conversation = mongoose.model('Conversation', conversationSchema);

// Message Model - الرسائل الفردية
const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, default: '' },
  isEdited: { type: Boolean, default: false },
  reactions: { type: Map, of: String, default: {} },
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  type: { type: String, enum: ['text', 'image', 'file'], default: 'text' },
  mediaUrl: { type: String, default: '' },
  isRead: { type: Boolean, default: false },
  readAt: { type: Date, default: null },
  isDeleted: { type: Boolean, default: false },
  deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);


// MQTT Client Setup
let mqttClient = null;

function initMQTT() {
  if (!process.env.MQTT_BROKER_URL) {
    console.log('⚠️ MQTT not configured, skipping...');
    return;
  }

  try {
    mqttClient = mqtt.connect(process.env.MQTT_BROKER_URL, {
      username: process.env.MQTT_USERNAME,
      password: process.env.MQTT_PASSWORD,
      rejectUnauthorized: false
    });

    mqttClient.on('connect', () => {
      console.log('✅ MQTT Connected to HiveMQ Cloud');
      // Subscribe to machine status topics
      mqttClient.subscribe(`${process.env.MQTT_TOPIC_PREFIX}/+/status`);
    });

    mqttClient.on('message', (topic, message) => {
      console.log(`📡 MQTT Message: ${topic}`, message.toString());
      handleMQTTMessage(topic, message.toString());
    });

    mqttClient.on('error', (err) => {
      console.error('❌ MQTT Error:', err);
    });
  } catch (error) {
    console.error('❌ MQTT Init Error:', error);
  }
}

async function handleMQTTMessage(topic, payload) {
  try {
    const data = JSON.parse(payload);
    const machineId = topic.split('/')[2];
    
    if (data.status === 'completed') {
      const productionLog = await ProductionLog.findOne({ 
        machineId, 
        status: { $in: ['started', 'in_progress'] } 
      });
      if (productionLog) {
        productionLog.status = 'completed';
        productionLog.completedAt = new Date();
        productionLog.progress = 100;
        await productionLog.save();
        
        await Design.findByIdAndUpdate(productionLog.designId, { 
          status: 'completed',
          completedAt: new Date()
        });
      }
    } else if (data.progress) {
      await ProductionLog.updateOne(
        { machineId, status: { $in: ['started', 'in_progress'] } },
        { progress: data.progress }
      );
    }
  } catch (error) {
    console.error('MQTT message handling error:', error);
  }
}

// Initialize MQTT on server start
initMQTT();
// ================ Middleware ================

const authenticateToken = async (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'naseej_secret_key');
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token.' });
  }
};

const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
};

// ================ Helper Functions ================

function getStatusLocation(status) {
  const locations = {
    pending: 'Order Placed',
    confirmed: 'Order Confirmed',
    processing: 'Warehouse',
    shipped: 'On Delivery',
    delivered: 'Delivered',
    cancelled: 'Cancelled'
  };
  return locations[status] || status;
}

function getStatusNote(status) {
  const notes = {
    pending: 'Your order has been received',
    confirmed: 'Your order has been confirmed',
    processing: 'Your order is being prepared',
    shipped: 'Your order is on the way',
    delivered: 'Your order has been delivered'
  };
  return notes[status] || '';
}

function getEstimatedDelivery(order) {
  const created = new Date(order.createdAt);
  const estimated = new Date(created);
  estimated.setDate(created.getDate() + 5);
  return estimated;
}

function getPaymentMethodName(type) {
  const names = {
    bank: 'Bank Transfer',
    paypal: 'PayPal',
    vodafone_cash: 'Vodafone Cash',
    instapay: 'InstaPay',
    fawry: 'Fawry'
  };
  return names[type] || type;
}

function getPaymentMethodDescription(method) {
  switch (method.type) {
    case 'bank':
      return `Transfer to ${method.bankDetails?.bankName || 'bank'} account`;
    case 'paypal':
      return `Pay with PayPal to ${method.paypalDetails?.email || 'seller'}`;
    case 'vodafone_cash':
      return `Pay via Vodafone Cash to ${method.mobileWalletDetails?.phoneNumber || 'seller'}`;
    case 'instapay':
      return `Pay via InstaPay to ${method.mobileWalletDetails?.phoneNumber || 'seller'}`;
    default:
      return 'Select this payment method';
  }
}

// ================ PayPal Integration ================
async function createPayPalPayment(order) {
  try {
    if (!paypalClient) {
      console.error('PayPal client not initialized');
      return null;
    }

    const request = new paypal.orders.OrdersCreateRequest();
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: order.orderNumber,
        amount: {
          currency_code: 'USD',
          value: ((order.totalAmount) / 50).toFixed(2),
          breakdown: {
            item_total: {
              currency_code: 'USD',
              value: (order.subtotal / 50).toFixed(2)
            },
            shipping: {
              currency_code: 'USD',
              value: (order.shippingCost / 50).toFixed(2)
            }
          }
        },
        items: order.items.map(item => ({
          name: item.name.substring(0, 127),
          quantity: item.quantity,
          unit_amount: {
            currency_code: 'USD',
            value: (item.unitPrice / 50).toFixed(2)
          }
        })),
        shipping: {
          address: {
            address_line_1: order.shippingAddress.street,
            admin_area_2: order.shippingAddress.city,
            country_code: 'EG'
          }
        }
      }],
      application_context: {
        return_url: `${process.env.FRONTEND_URL}/order-tracking/${order.orderNumber}`,
        cancel_url: `${process.env.FRONTEND_URL}/cart`,
        brand_name: 'Naseej',
        locale: 'en-EG',
        shipping_preference: 'SET_PROVIDED_ADDRESS',
        user_action: 'PAY_NOW'
      }
    });

    const response = await paypalClient.execute(request);
    const approvalUrl = response.result.links.find(link => link.rel === 'approve').href;

    order.paypalOrderId = response.result.id;
    await order.save();

    return approvalUrl;
  } catch (error) {
    console.error('PayPal payment creation error:', error.message);
    return null;
  }
}

// ================ Stripe Integration ================
async function createStripePayment(order) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      console.error('Stripe secret key is missing');
      return null;
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: order.items.map(item => ({
        price_data: {
          currency: 'egp',
          product_data: {
            name: item.name,
            images: item.productId?.imageUrl ? [item.productId.imageUrl] : [],
          },
          unit_amount: Math.round(item.unitPrice * 100),
        },
        quantity: item.quantity,
      })),
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: {
              amount: Math.round(order.shippingCost * 100),
              currency: 'egp',
            },
            display_name: 'Standard Shipping',
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 3 },
              maximum: { unit: 'business_day', value: 5 },
            },
          },
        },
      ],
      discounts: order.discount > 0 ? [{
        coupon: await createStripeCoupon(order.discount, order.subtotal)
      }] : [],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/order-tracking/${order.orderNumber}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/cart`,
      customer_email: order.shippingAddress.email,
      metadata: {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber
      }
    });

    return session.url;
  } catch (error) {
    console.error('Stripe payment creation error:', error.message);
    return null;
  }
}

async function createStripeCoupon(discountAmount, subtotal) {
  try {
    const percentOff = Math.round((discountAmount / subtotal) * 100);
    const coupon = await stripe.coupons.create({
      percent_off: percentOff,
      duration: 'once',
      name: `Order Discount ${percentOff}%`
    });
    return coupon.id;
  } catch (error) {
    console.error('Stripe coupon error:', error);
    return null;
  }
}

// ================ Webhooks ================
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      const order = await Order.findOne({ orderNumber: session.metadata.orderNumber });
      if (order) {
        order.paymentStatus = 'paid';
        order.orderStatus = 'confirmed';
        await order.save();
        console.log(`Order ${order.orderNumber} paid via Stripe`);
      }
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});

app.post('/api/webhooks/paypal/capture', async (req, res) => {
  const { orderId, payerId, orderNumber } = req.body;

  try {
    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});

    const response = await paypalClient.execute(request);

    if (response.result.status === 'COMPLETED') {
      const order = await Order.findOne({ orderNumber });
      if (order) {
        order.paymentStatus = 'paid';
        order.orderStatus = 'confirmed';
        order.paypalCaptureId = response.result.purchase_units[0].payments.captures[0].id;
        await order.save();
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('PayPal capture error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ================ Auth Routes ================

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, role } = req.body;

    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res.status(400).json({ error: 'Username or email already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, email, password: hashedPassword, role: role || 'seller' });
    await user.save();

    const token = jwt.sign({
      userId: user._id,
      username: user.username,
      email: user.email,
      role: user.role
    }, process.env.JWT_SECRET || 'naseej_secret_key', { expiresIn: '7d' });

    res.status(201).json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    // ✅ تحديث آخر ظهور وحالة الاتصال
    user.lastSeen = new Date();
    user.isOnline = true;
    await user.save();

    const token = jwt.sign({
      userId: user._id,
      username: user.username,
      email: user.email,
      role: user.role
    }, process.env.JWT_SECRET || 'naseej_secret_key', { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        lastSeen: user.lastSeen,
        isOnline: user.isOnline
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    const { username, phone, address } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { username, phone, address },
      { new: true }
    ).select('-password');
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});




// تحديث آخر ظهور (Ping)
app.post('/api/user/ping', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    await User.findByIdAndUpdate(userId, {
      lastSeen: new Date(),
      isOnline: true
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Ping error:', error);
    res.status(500).json({ error: error.message });
  }
});

// تحديث حالة عدم الاتصال (عند تسجيل الخروج)
app.post('/api/user/offline', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    await User.findByIdAndUpdate(userId, {
      isOnline: false,
      lastSeen: new Date()
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Offline error:', error);
    res.status(500).json({ error: error.message });
  }
});
// ================ Product Routes ================

app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/products/slug/:slug', async (req, res) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug });
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    product.views += 1;
    await product.save();
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/products/:productId/related', async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const relatedProducts = await Product.find({
      _id: { $ne: product._id },
      $or: [
        { category: product.category },
        { material: product.material },
        { subcategory: product.subcategory },
        { tags: { $in: product.tags } }
      ],
      inStock: true
    })
      .limit(8)
      .sort({ soldCount: -1, views: -1 });

    res.json(relatedProducts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/products/featured', async (req, res) => {
  try {
    const products = await Product.find({ isFeatured: true, inStock: true })
      .limit(6)
      .sort({ createdAt: -1 });
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/products/new-arrivals', async (req, res) => {
  try {
    const products = await Product.find({ isNew: true, inStock: true })
      .limit(8)
      .sort({ createdAt: -1 });
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/products/search', async (req, res) => {
  try {
    const { q, category, minPrice, maxPrice, sort, page = 1, limit = 20 } = req.query;
    const query = { inStock: true };

    if (q) {
      query.$or = [
        { name: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
        { tags: { $in: [new RegExp(q, 'i')] } }
      ];
    }
    if (category && category !== 'all') query.category = category;
    if (minPrice) query.price = { $gte: parseInt(minPrice) };
    if (maxPrice) query.price = { ...query.price, $lte: parseInt(maxPrice) };

    let sortOption = { createdAt: -1 };
    if (sort === 'price_asc') sortOption = { price: 1 };
    if (sort === 'price_desc') sortOption = { price: -1 };
    if (sort === 'popular') sortOption = { soldCount: -1 };
    if (sort === 'rating') sortOption = { rating: -1 };

    const products = await Product.find(query)
      .sort(sortOption)
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Product.countDocuments(query);

    res.json({ products, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/products', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user.canSell && user.role !== 'admin') {
      return res.status(403).json({ error: 'You need to create a store first' });
    }
    
    const store = await Store.findOne({ ownerId: req.user.userId });
    if (!store && user.role !== 'admin') {
      return res.status(403).json({ error: 'Store not found' });
    }
    
    const { name, category, subcategory, material, size, color, price, oldPrice, quantity, imageUrl, images, description, features, tags, isFeatured, isNew, discount } = req.body;
    
    const storeId = user.role === 'admin' ? req.body.storeId : store._id;
    const ownerId = req.user.userId;
    
    const slug = `${storeId}-${name
      .toLowerCase()
      .replace(/[^a-z0-9\u0621-\u064A]+/g, '-')
      .replace(/^-|-$/g, '')}`;
    
    const existingProduct = await Product.findOne({ slug });
    if (existingProduct) {
      return res.status(400).json({ error: 'Product with similar name already exists' });
    }
    
    const product = new Product({
      name, slug, storeId, ownerId, category, subcategory, material, size, color,
      price, oldPrice, quantity, imageUrl, images, description,
      features, tags, isFeatured, isNew, discount,
      status: 'active', // ✅ تغيير: جميع المنتجات تصبح active مباشرة
      inStock: quantity > 0
    });
    
    await product.save();
    
    await Store.findByIdAndUpdate(storeId, {
      $inc: { 'stats.totalProducts': 1 }
    });
    
    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/products/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    const updateData = req.body;
    if (updateData.name) {
      updateData.slug = updateData.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }
    updateData.inStock = updateData.quantity > 0;

    const product = await Product.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/products/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    res.json({ message: 'Product deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/products/:productId/rate', authenticateToken, async (req, res) => {
  try {
    const { rating } = req.body;
    const product = await Product.findById(req.params.productId);

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const newRating = (product.rating * product.reviewCount + rating) / (product.reviewCount + 1);
    product.rating = Math.round(newRating * 10) / 10;
    product.reviewCount += 1;
    await product.save();

    res.json({ success: true, rating: product.rating, reviewCount: product.reviewCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================ Review Routes ================

app.get('/api/reviews/product/:slug', async (req, res) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug });
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const reviews = await Review.find({ productId: product._id })
      .populate('userId', 'username')
      .sort({ timestamp: -1 });

    res.json(reviews);
  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/reviews', authenticateToken, async (req, res) => {
  try {
    const { productId, rating, text } = req.body;

    if (!productId || !rating || !text) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const existingReview = await Review.findOne({
      productId,
      userId: req.user.userId
    });

    if (existingReview) {
      return res.status(400).json({ error: 'You have already reviewed this product' });
    }

    const review = new Review({
      productId,
      userId: req.user.userId,
      rating,
      text
    });

    await review.save();

    const allReviews = await Review.find({ productId });
    const avgRating = allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length;
    product.rating = Math.round(avgRating * 10) / 10;
    product.reviewCount = allReviews.length;
    await product.save();

    res.status(201).json({ success: true, review });
  } catch (error) {
    console.error('Error creating review:', error);
    res.status(500).json({ error: error.message });
  }
});

// ================ Customer Routes ================

app.get('/api/customers', authenticateToken, async (req, res) => {
  try {
    const customers = await Customer.find().sort({ registeredAt: -1 });
    res.json(customers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/customers', authenticateToken, async (req, res) => {
  try {
    const { name, phone, address, email } = req.body;
    const customer = new Customer({ name, phone, address, email });
    await customer.save();
    res.status(201).json(customer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================ Invoice Routes ================

app.post('/api/invoices', authenticateToken, async (req, res) => {
  try {
    const { customerId, items } = req.body;

    let totalAmount = 0;
    const invoiceItems = [];

    for (const item of items) {
      const product = await Product.findById(item.productId);
      if (!product) {
        return res.status(404).json({ error: `Product ${item.productId} not found.` });
      }
      if (product.quantity < item.quantity) {
        return res.status(400).json({ error: `Insufficient stock for ${product.name}. Available: ${product.quantity}` });
      }

      const subtotal = product.price * item.quantity;
      totalAmount += subtotal;

      invoiceItems.push({
        productId: product._id,
        quantity: item.quantity,
        unitPrice: product.price,
        subtotal
      });

      product.quantity -= item.quantity;
      product.inStock = product.quantity > 0;
      await product.save();
    }

    const invoiceNumber = `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const invoice = new Invoice({
      invoiceNumber,
      sellerId: req.user.userId,
      customerId,
      items: invoiceItems,
      totalAmount
    });

    await invoice.save();

    const populatedInvoice = await Invoice.findById(invoice._id)
      .populate('sellerId', 'username')
      .populate('customerId', 'name phone')
      .populate('items.productId', 'name');

    res.status(201).json(populatedInvoice);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/invoices', authenticateToken, async (req, res) => {
  try {
    const invoices = await Invoice.find()
      .populate('sellerId', 'username')
      .populate('customerId', 'name phone')
      .populate('items.productId', 'name')
      .sort({ date: -1 });
    res.json(invoices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/invoices/:id', authenticateToken, async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('sellerId', 'username')
      .populate('customerId', 'name phone address')
      .populate('items.productId', 'name category');
    if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
    res.json(invoice);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================ Order Routes ================

app.post('/api/orders', authenticateToken, async (req, res) => {
  try {
    const { customerId, items, shippingAddress, paymentMethod, couponCode } = req.body;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      const product = await Product.findById(item.productId);
      if (!product) {
        return res.status(404).json({ error: `Product ${item.productId} not found` });
      }
      if (product.quantity < item.quantity) {
        return res.status(400).json({ error: `Insufficient stock for ${product.name}. Available: ${product.quantity}` });
      }

      const itemTotal = product.price * item.quantity;
      subtotal += itemTotal;

      orderItems.push({
        productId: product._id,
        name: product.name,
        quantity: item.quantity,
        unitPrice: product.price,
        subtotal: itemTotal,
        storeId: product.storeId
      });

      product.quantity -= item.quantity;
      product.inStock = product.quantity > 0;
      product.soldCount += item.quantity;
      await product.save();
    }

    let discount = 0;
    let coupon = null;
    if (couponCode) {
      coupon = await Coupon.findOne({
        code: couponCode.toUpperCase(),
        isActive: true,
        validFrom: { $lte: new Date() },
        validTo: { $gte: new Date() }
      });
      if (coupon && coupon.usedCount < coupon.usageLimit && subtotal >= coupon.minOrderAmount) {
        if (coupon.discountType === 'percentage') {
          discount = (subtotal * coupon.discountValue) / 100;
          if (coupon.maxDiscount > 0 && discount > coupon.maxDiscount) {
            discount = coupon.maxDiscount;
          }
        } else {
          discount = coupon.discountValue;
        }
        coupon.usedCount += 1;
        await coupon.save();
      }
    }

    const shippingRate = await ShippingRate.findOne({
      city: shippingAddress.city,
      isActive: true
    });
    const shippingCost = shippingRate ? shippingRate.cost : (subtotal >= 1000 ? 0 : 50);

    const totalAmount = subtotal - discount + shippingCost;
    const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const validPaymentMethods = ['cash', 'paypal', 'card', 'bank', 'vodafone_cash', 'instapay', 'fawry'];
    if (!validPaymentMethods.includes(paymentMethod)) {
      return res.status(400).json({ error: `Invalid payment method: ${paymentMethod}` });
    }

    // جلب طريقة الدفع الخاصة بالمتجر
    let storePaymentMethod = null;
    if (paymentMethod !== 'cash' && paymentMethod !== 'paypal' && paymentMethod !== 'card') {
      const store = await Store.findOne({ ownerId: req.user.userId });
      if (store) {
        storePaymentMethod = await PayoutMethod.findOne({ 
          storeId: store._id, 
          type: paymentMethod,
          status: 'active'
        });
      }
    }

    const order = new Order({
      orderNumber,
      customerId,
      items: orderItems,
      shippingAddress: {
        ...shippingAddress,
        phone: shippingAddress.phone || customer.phone
      },
      shippingCost,
      discount,
      couponCode: couponCode || '',
      subtotal,
      totalAmount,
      paymentMethod,
      paymentStatus: paymentMethod === 'cash' ? 'pending' : 'pending',
      orderStatus: 'pending',
      trackingHistory: [{
        status: 'pending',
        location: 'Order placed',
        note: 'Your order has been received and is pending confirmation'
      }]
    });

    await order.save();

    let paymentUrl = null;
    let paymentInstruction = null;

    // معالجة طرق الدفع المختلفة
    if (paymentMethod === 'paypal') {
      paymentUrl = await createPayPalPayment(order);
    } else if (paymentMethod === 'card') {
      paymentUrl = await createStripePayment(order);
    } else if (paymentMethod === 'vodafone_cash' && storePaymentMethod) {
      paymentInstruction = await createVodafoneCashPayment(order, storePaymentMethod);
    } else if (paymentMethod === 'instapay' && storePaymentMethod) {
      paymentInstruction = await createInstaPayPayment(order, storePaymentMethod);
    } else if (paymentMethod === 'bank' && storePaymentMethod) {
      paymentInstruction = await createBankTransferPayment(order, storePaymentMethod);
    }

    res.status(201).json({
      success: true,
      order,
      paymentUrl,
      paymentInstruction
    });

  } catch (error) {
    console.error('Order creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { status, fromDate, toDate, page = 1, limit = 20 } = req.query;
    const query = {};

    if (status) query.orderStatus = status;
    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) query.createdAt.$gte = new Date(fromDate);
      if (toDate) query.createdAt.$lte = new Date(toDate);
    }

    const orders = await Order.find(query)
      .populate('customerId', 'name phone')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Order.countDocuments(query);

    res.json({ orders, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders/my-orders', authenticateToken, async (req, res) => {
  try {
    console.log('My orders requested - user:', req.user);

    let customer = await Customer.findOne({ email: req.user.email });

    if (!customer) {
      const user = await User.findById(req.user.userId);
      if (user && user.email) {
        customer = await Customer.findOne({ email: user.email });
      }
    }

    if (!customer) {
      console.log('No customer found for email:', req.user.email);
      return res.json([]);
    }

    const orders = await Order.find({ customerId: customer._id })
      .populate('items.productId', 'name imageUrl')
      .sort({ createdAt: -1 });

    const formattedOrders = orders.map(order => ({
      ...order._doc,
      items: order.items.map(item => ({
        name: item.productId?.name || item.name || 'Product',
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        subtotal: item.subtotal
      }))
    }));

    res.json(formattedOrders);
  } catch (error) {
    console.error('Error fetching my orders:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders/:orderId', authenticateToken, async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId)
      .populate('customerId', 'name phone email')
      .populate('items.productId', 'name imageUrl');

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const customer = await Customer.findOne({ email: req.user.email });
    if (req.user.role !== 'admin' && (!customer || order.customerId._id.toString() !== customer._id.toString())) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/orders/:orderId/status', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { status, trackingNumber, note } = req.body;
    const order = await Order.findById(req.params.orderId);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    order.orderStatus = status;
    if (trackingNumber) order.trackingNumber = trackingNumber;

    order.trackingHistory.push({
      status,
      location: getStatusLocation(status),
      note: note || getStatusNote(status)
    });

    if (status === 'delivered') {
      order.deliveredAt = new Date();
      order.paymentStatus = 'paid';
    }
    if (status === 'cancelled') {
      order.cancelledAt = new Date();
      for (const item of order.items) {
        await Product.findByIdAndUpdate(item.productId, {
          $inc: { quantity: item.quantity }
        });
      }
    }

    await order.save();
    res.json({ success: true, order });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders/track/:orderNumber', async (req, res) => {
  try {
    const order = await Order.findOne({ orderNumber: req.params.orderNumber })
      .populate('items.productId', 'name imageUrl price');

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const formattedItems = order.items.map(item => ({
      name: item.productId?.name || item.name || 'Product',
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      subtotal: item.subtotal
    }));

    res.json({
      orderNumber: order.orderNumber,
      orderStatus: order.orderStatus,
      trackingNumber: order.trackingNumber,
      trackingHistory: order.trackingHistory,
      items: formattedItems,
      subtotal: order.subtotal,
      discount: order.discount,
      shippingCost: order.shippingCost,
      totalAmount: order.totalAmount,
      shippingAddress: order.shippingAddress,
      estimatedDelivery: order.orderStatus === 'shipped' ? getEstimatedDelivery(order) : null,
      createdAt: order.createdAt
    });
  } catch (error) {
    console.error('Track order error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orders/shipping-cost', async (req, res) => {
  try {
    const { city, district, subtotal } = req.body;

    let shippingRate = await ShippingRate.findOne({ city, isActive: true });
    if (!shippingRate && district) {
      shippingRate = await ShippingRate.findOne({ city, district, isActive: true });
    }

    let shippingCost = shippingRate ? shippingRate.cost : 50;

    if (subtotal >= 1000) {
      shippingCost = 0;
    }

    res.json({ shippingCost, estimatedDays: shippingRate?.estimatedDays || 3 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/coupons/validate', async (req, res) => {
  try {
    const { code, subtotal } = req.body;

    const coupon = await Coupon.findOne({
      code: code.toUpperCase(),
      isActive: true,
      validFrom: { $lte: new Date() },
      validTo: { $gte: new Date() }
    });

    if (!coupon) {
      return res.status(404).json({ error: 'Invalid or expired coupon' });
    }

    if (coupon.usedCount >= coupon.usageLimit) {
      return res.status(400).json({ error: 'Coupon usage limit reached' });
    }

    if (subtotal < coupon.minOrderAmount) {
      return res.status(400).json({ error: `Minimum order amount for this coupon is ${coupon.minOrderAmount} EGP` });
    }

    let discount = 0;
    if (coupon.discountType === 'percentage') {
      discount = (subtotal * coupon.discountValue) / 100;
      if (coupon.maxDiscount > 0 && discount > coupon.maxDiscount) {
        discount = coupon.maxDiscount;
      }
    } else {
      discount = coupon.discountValue;
    }

    res.json({ discount, coupon });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================ Dashboard Stats ================

app.get('/api/stats', authenticateToken, isAdmin, async (req, res) => {
  try {
    console.log('Stats endpoint called by user:', req.user?.username);

    const totalProducts = await Product.countDocuments();
    const totalCustomers = await Customer.countDocuments();
    const totalInvoices = await Invoice.countDocuments();
    const totalOrders = await Order.countDocuments();

    const invoices = await Invoice.find();
    const totalSales = invoices.reduce((sum, inv) => sum + inv.totalAmount, 0);

    const orders = await Order.find();
    const totalOrderValue = orders.reduce((sum, ord) => sum + ord.totalAmount, 0);

    const lowStockProducts = await Product.find({ quantity: { $lt: 10 } });

    const productSales = {};
    for (const order of orders) {
      for (const item of order.items) {
        const productId = item.productId?.toString();
        if (productId) {
          if (!productSales[productId]) {
            productSales[productId] = { quantity: 0, revenue: 0 };
          }
          productSales[productId].quantity += item.quantity;
          productSales[productId].revenue += item.subtotal;
        }
      }
    }

    const topProducts = await Promise.all(
      Object.entries(productSales)
        .sort((a, b) => b[1].quantity - a[1].quantity)
        .slice(0, 5)
        .map(async ([id, data]) => {
          const product = await Product.findById(id);
          return { name: product?.name || 'Unknown', ...data };
        })
    );

    res.json({
      totalProducts,
      totalCustomers,
      totalInvoices,
      totalOrders,
      totalSales,
      totalOrderValue,
      lowStockCount: lowStockProducts.length,
      lowStockProducts,
      topProducts
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ================ Store Routes ================

app.get('/api/stores', async (req, res) => {
  try {
    const stores = await Store.find({ 'settings.isActive': true })
      .select('name slug logo description stats')
      .sort({ createdAt: -1 });
    res.json(stores);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stores/:slug', async (req, res) => {
  try {
    const store = await Store.findOne({ slug: req.params.slug, 'settings.isActive': true })
      .populate('ownerId', 'username email');
    
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }
    
    const products = await Product.find({ 
      storeId: store._id, 
      status: 'active',
      inStock: true 
    }).sort({ createdAt: -1 });
    
    res.json({ store, products });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stores/:storeSlug/product/:productSlug', async (req, res) => {
  try {
    const { storeSlug, productSlug } = req.params;
    
    console.log('🔍 Searching for product:', { storeSlug, productSlug });
    
    // جلب المتجر
    const store = await Store.findOne({ slug: storeSlug });
    if (!store) {
      console.log('❌ Store not found:', storeSlug);
      return res.status(404).json({ error: 'Store not found' });
    }
    
    console.log('✅ Store found:', store._id, store.name);
    
    // طرق متعددة للبحث عن المنتج
    let product = null;
    
    // 1. البحث بالـ slug الكامل (الذي يحتوي على معرف المتجر)
    const fullSlugPattern = new RegExp(`^${store._id}.*${productSlug}`, 'i');
    product = await Product.findOne({
      $or: [
        { slug: productSlug }, // الرابط المباشر
        { slug: fullSlugPattern }, // slug يبدأ بمعرف المتجر
        { slug: { $regex: productSlug, $options: 'i' } }, // يحتوي على النص
        { name: { $regex: `^${productSlug.replace(/-/g, ' ')}`, $options: 'i' } } // يبدأ بالاسم
      ],
      storeId: store._id
    });
    
    // 2. إذا لم يتم العثور، جرب البحث في كل المتاجر
    if (!product) {
      product = await Product.findOne({ 
        slug: { $regex: productSlug, $options: 'i' }
      });
    }
    
    // 3. إذا لم يتم العثور، جرب البحث بالاسم بالكامل
    if (!product) {
      const namePattern = productSlug.replace(/-/g, ' ');
      product = await Product.findOne({
        name: { $regex: namePattern, $options: 'i' },
        storeId: store._id
      });
    }
    
    if (!product) {
      console.log('❌ Product not found for:', productSlug);
      return res.status(404).json({ error: 'Product not found in this store' });
    }
    
    console.log('✅ Product found:', product._id, product.name, 'Slug:', product.slug);
    
    // زيادة عدد المشاهدات
    product.views += 1;
    await product.save();
    
    res.json({ store, product });
  } catch (error) {
    console.error('❌ Error fetching store product:', error);
    res.status(500).json({ error: error.message });
  }
});
// إنشاء متجر جديد (للمستخدم)
app.post('/api/stores', authenticateToken, async (req, res) => {
  try {
    const { name, description, contact, socialLinks, logo, coverImage } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Store name is required' });
    }
    
    const existingStore = await Store.findOne({ ownerId: req.user.userId });
    if (existingStore) {
      return res.status(400).json({ error: 'You already have a store' });
    }
    
    // إنشاء slug فريد
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9\u0621-\u064A]+/g, '-')
      .replace(/^-|-$/g, '') + '-' + Date.now();
    
    const store = new Store({
      name,
      slug,
      ownerId: req.user.userId,
      description: description || '',
      logo: logo || '',
      coverImage: coverImage || '',
      contact: contact || { phone: '', email: '', address: '', city: '' },
      socialLinks: socialLinks || {},
      'settings.isActive': true,
      stats: { totalProducts: 0, totalSales: 0, totalRevenue: 0, views: 0 }
    });
    
    await store.save();
    
    await User.findByIdAndUpdate(req.user.userId, { 
      storeId: store._id,
      canSell: true,
      role: 'seller'
    });
    
    res.status(201).json(store);
  } catch (error) {
    console.error('Error creating store:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/stores/:slug', authenticateToken, async (req, res) => {
  try {
    const store = await Store.findOne({ slug: req.params.slug });
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }
    
    if (store.ownerId.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    Object.assign(store, req.body);
    await store.save();
    
    res.json(store);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================ Payout Methods Routes ================

app.post('/api/payouts/methods', authenticateToken, async (req, res) => {
  try {
    const store = await Store.findOne({ ownerId: req.user.userId });
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }
    
    const { type, isDefault, bankDetails, paypalDetails, mobileWalletDetails } = req.body;
    
    if (isDefault) {
      await PayoutMethod.updateMany(
        { storeId: store._id, isDefault: true },
        { isDefault: false }
      );
    }
    
    const payoutMethod = new PayoutMethod({
      storeId: store._id,
      type,
      isDefault: isDefault || false,
      bankDetails: bankDetails || {},
      paypalDetails: paypalDetails || {},
      mobileWalletDetails: mobileWalletDetails || {},
      status: 'active'
    });
    
    await payoutMethod.save();
    res.status(201).json(payoutMethod);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/payouts/methods', authenticateToken, async (req, res) => {
  try {
    const store = await Store.findOne({ ownerId: req.user.userId });
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }
    
    const methods = await PayoutMethod.find({ storeId: store._id });
    res.json(methods);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/payouts/methods/:methodId', authenticateToken, async (req, res) => {
  try {
    const store = await Store.findOne({ ownerId: req.user.userId });
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }
    
    const method = await PayoutMethod.findById(req.params.methodId);
    if (!method) {
      return res.status(404).json({ error: 'Method not found' });
    }
    
    if (method.storeId.toString() !== store._id.toString()) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const { type, isDefault, bankDetails, paypalDetails, mobileWalletDetails } = req.body;
    
    if (isDefault && !method.isDefault) {
      await PayoutMethod.updateMany(
        { storeId: store._id, isDefault: true },
        { isDefault: false }
      );
    }
    
    Object.assign(method, { type, isDefault, bankDetails, paypalDetails, mobileWalletDetails });
    await method.save();
    
    res.json(method);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/payouts/methods/:methodId/default', authenticateToken, async (req, res) => {
  try {
    const store = await Store.findOne({ ownerId: req.user.userId });
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }
    
    const method = await PayoutMethod.findById(req.params.methodId);
    if (!method) {
      return res.status(404).json({ error: 'Method not found' });
    }
    
    if (method.storeId.toString() !== store._id.toString()) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    await PayoutMethod.updateMany(
      { storeId: store._id, isDefault: true },
      { isDefault: false }
    );
    
    method.isDefault = true;
    await method.save();
    
    res.json({ success: true, method });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/payouts/methods/:methodId', authenticateToken, async (req, res) => {
  try {
    const store = await Store.findOne({ ownerId: req.user.userId });
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }
    
    const method = await PayoutMethod.findById(req.params.methodId);
    if (!method) {
      return res.status(404).json({ error: 'Method not found' });
    }
    
    if (method.storeId.toString() !== store._id.toString()) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    await method.deleteOne();
    res.json({ success: true, message: 'Payment method deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================ Store Payment Methods (Public) ================

app.get('/api/stores/:storeId/payment-methods', async (req, res) => {
  try {
    const store = await Store.findById(req.params.storeId);
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }
    
    const methods = await PayoutMethod.find({ 
      storeId: store._id, 
      status: 'active' 
    });
    
    const formattedMethods = methods.map(method => ({
      type: method.type,
      name: getPaymentMethodName(method.type),
      isActive: true,
      description: getPaymentMethodDescription(method),
      bankDetails: method.bankDetails,
      paypalDetails: method.paypalDetails,
      mobileWalletDetails: method.mobileWalletDetails
    }));
    
    res.json(formattedMethods);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================ Seller Routes ================

app.get('/api/seller/stats', authenticateToken, async (req, res) => {
  try {
    const store = await Store.findOne({ ownerId: req.user.userId });
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }
    
    const products = await Product.find({ storeId: store._id });
    const orders = await Order.find({ 'items.storeId': store._id });
    
    const totalRevenue = orders.reduce((sum, order) => {
      const storeItems = order.items.filter(item => item.storeId?.toString() === store._id.toString());
      return sum + storeItems.reduce((s, item) => s + item.subtotal, 0);
    }, 0);
    
    res.json({
      totalProducts: products.length,
      totalSales: orders.length,
      totalRevenue,
      storeViews: store.stats?.views || 0,
      averageRating: store.stats?.averageRating || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/seller/products', authenticateToken, async (req, res) => {
  try {
    const store = await Store.findOne({ ownerId: req.user.userId });
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }
    
    const products = await Product.find({ storeId: store._id }).sort({ createdAt: -1 });
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/seller/products', authenticateToken, async (req, res) => {
  try {
    const store = await Store.findOne({ ownerId: req.user.userId });
    if (!store) {
      return res.status(404).json({ error: 'Store not found. Please create a store first.' });
    }
    
    const { name, category, subcategory, material, size, color, price, oldPrice, quantity, imageUrl, images, description, features, tags, discount } = req.body;
    
    const slug = `${store._id}-${name
      .toLowerCase()
      .replace(/[^a-z0-9\u0621-\u064A]+/g, '-')
      .replace(/^-|-$/g, '')}`;
    
    const product = new Product({
      name, slug, storeId: store._id, ownerId: req.user.userId,
      category, subcategory, material, size, color,
      price, oldPrice, quantity, imageUrl, images, description,
      features, tags, discount,
      status: 'active', // تغيير من 'pending' إلى 'active'
      inStock: quantity > 0
    });
    
    await product.save();
    await Store.findByIdAndUpdate(store._id, { $inc: { 'stats.totalProducts': 1 } });
    
    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/seller/products/:productId', authenticateToken, async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    
    const store = await Store.findOne({ ownerId: req.user.userId });
    if (!store || product.storeId.toString() !== store._id.toString()) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    Object.assign(product, req.body);
    await product.save();
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/seller/products/:productId', authenticateToken, async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    
    const store = await Store.findOne({ ownerId: req.user.userId });
    if (!store || product.storeId.toString() !== store._id.toString()) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    await product.deleteOne();
    await Store.findByIdAndUpdate(store._id, { $inc: { 'stats.totalProducts': -1 } });
    
    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/seller/orders', authenticateToken, async (req, res) => {
  try {
    const store = await Store.findOne({ ownerId: req.user.userId });
    if (!store) return res.status(404).json({ error: 'Store not found' });
    
    const orders = await Order.find({ 'items.storeId': store._id })
      .populate('customerId', 'name phone')
      .sort({ createdAt: -1 });
    
    const formattedOrders = orders.map(order => ({
      ...order._doc,
      items: order.items.filter(item => item.storeId?.toString() === store._id.toString())
    }));
    
    res.json(formattedOrders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/seller/orders/:orderId/status', authenticateToken, async (req, res) => {
  try {
    const { status, trackingNumber } = req.body;
    const store = await Store.findOne({ ownerId: req.user.userId });
    if (!store) return res.status(404).json({ error: 'Store not found' });
    
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    
    const hasStoreItem = order.items.some(item => item.storeId?.toString() === store._id.toString());
    if (!hasStoreItem) return res.status(403).json({ error: 'Unauthorized' });
    
    order.orderStatus = status;
    if (trackingNumber) order.trackingNumber = trackingNumber;
    await order.save();
    
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================ Seller Routes ================

// جلب معلومات المتجر (للبائع)
app.get('/api/seller/store', authenticateToken, async (req, res) => {
  try {
    const store = await Store.findOne({ ownerId: req.user.userId });
    if (!store) return res.status(404).json({ error: 'Store not found' });
    res.json(store);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// إنشاء أو تحديث المتجر (للبائع)
app.put('/api/seller/store', authenticateToken, async (req, res) => {
  try {
    console.log('Updating/creating store for user:', req.user.userId);
    
    let store = await Store.findOne({ ownerId: req.user.userId });
    
    const { name, description, logo, coverImage, contact, socialLinks, paymentSettings } = req.body;
    
    if (!store) {
      // إنشاء متجر جديد إذا لم يكن موجوداً
      console.log('No store found, creating new store...');
      
      // التحقق من وجود اسم للمتجر
      if (!name) {
        return res.status(400).json({ error: 'Store name is required' });
      }
      
      // إنشاء slug فريد
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9\u0621-\u064A]+/g, '-')
        .replace(/^-|-$/g, '') + '-' + Date.now();
      
      store = new Store({
        name,
        slug,
        ownerId: req.user.userId,
        description: description || '',
        logo: logo || '',
        coverImage: coverImage || '',
        contact: contact || { phone: '', email: '', address: '', city: '' },
        socialLinks: socialLinks || { facebook: '', instagram: '', twitter: '', whatsapp: '' },
        paymentSettings: paymentSettings || { minimumPayout: 500, autoReleaseDays: 14 },
        'settings.isActive': true,
        stats: { totalProducts: 0, totalSales: 0, totalRevenue: 0, views: 0 }
      });
      
      await store.save();
      
      // تحديث بيانات المستخدم
      await User.findByIdAndUpdate(req.user.userId, { 
        storeId: store._id,
        canSell: true,
        role: 'seller'
      });
      
      console.log('Store created successfully:', store._id);
    } else {
      // تحديث المتجر الموجود
      if (name) store.name = name;
      if (description !== undefined) store.description = description;
      if (logo !== undefined) store.logo = logo;
      if (coverImage !== undefined) store.coverImage = coverImage;
      if (contact) store.contact = { ...store.contact, ...contact };
      if (socialLinks) store.socialLinks = { ...store.socialLinks, ...socialLinks };
      if (paymentSettings) store.paymentSettings = { ...store.paymentSettings, ...paymentSettings };
      
      await store.save();
      console.log('Store updated successfully:', store._id);
    }
    
    res.json(store);
  } catch (error) {
    console.error('Error updating/creating store:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/seller/store', authenticateToken, async (req, res) => {
  try {
    console.log('Updating store for user:', req.user.userId);
    
    const store = await Store.findOne({ ownerId: req.user.userId });
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }
    
    const { name, description, logo, coverImage, contact, socialLinks, paymentSettings } = req.body;
    
    if (name) store.name = name;
    if (description !== undefined) store.description = description;
    if (logo !== undefined) store.logo = logo;
    if (coverImage !== undefined) store.coverImage = coverImage;
    if (contact) store.contact = { ...store.contact, ...contact };
    if (socialLinks) store.socialLinks = { ...store.socialLinks, ...socialLinks };
    if (paymentSettings) store.paymentSettings = { ...store.paymentSettings, ...paymentSettings };
    
    await store.save();
    
    console.log('Store updated successfully:', store._id);
    res.json(store);
  } catch (error) {
    console.error('Error updating store:', error);
    res.status(500).json({ error: error.message });
  }
});



// ================ Store Follow Routes ================

// متابعة متجر
app.post('/api/stores/:storeSlug/follow', authenticateToken, async (req, res) => {
  try {
    const { storeSlug } = req.params;
    const userId = req.user.userId;
    
    // جلب المتجر
    const store = await Store.findOne({ slug: storeSlug });
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }
    
    // جلب المستخدم
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // التحقق إذا كان المستخدم يتابع المتجر بالفعل
    if (user.followingStores && user.followingStores.includes(store._id)) {
      return res.status(400).json({ error: 'Already following this store' });
    }
    
    // إضافة المتجر إلى قائمة المتابعة
    if (!user.followingStores) {
      user.followingStores = [];
    }
    user.followingStores.push(store._id);
    await user.save();
    
    // تحديث إحصائيات المتجر
    await Store.findByIdAndUpdate(store._id, {
      $inc: { 'stats.followers': 1 }
    });
    
    res.json({ success: true, message: `Now following ${store.name}` });
  } catch (error) {
    console.error('Follow store error:', error);
    res.status(500).json({ error: error.message });
  }
});

// إلغاء متابعة متجر
app.delete('/api/stores/:storeSlug/follow', authenticateToken, async (req, res) => {
  try {
    const { storeSlug } = req.params;
    const userId = req.user.userId;
    
    // جلب المتجر
    const store = await Store.findOne({ slug: storeSlug });
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }
    
    // جلب المستخدم
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // إزالة المتجر من قائمة المتابعة
    if (user.followingStores) {
      user.followingStores = user.followingStores.filter(
        id => id.toString() !== store._id.toString()
      );
      await user.save();
    }
    
    // تحديث إحصائيات المتجر
    await Store.findByIdAndUpdate(store._id, {
      $inc: { 'stats.followers': -1 }
    });
    
    res.json({ success: true, message: `Unfollowed ${store.name}` });
  } catch (error) {
    console.error('Unfollow store error:', error);
    res.status(500).json({ error: error.message });
  }
});

// التحقق من متابعة متجر
app.get('/api/stores/:storeSlug/follow/check', authenticateToken, async (req, res) => {
  try {
    const { storeSlug } = req.params;
    const userId = req.user.userId;
    
    // جلب المتجر
    const store = await Store.findOne({ slug: storeSlug });
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }
    
    // جلب المستخدم
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const isFollowing = user.followingStores && 
      user.followingStores.some(id => id.toString() === store._id.toString());
    
    res.json({ following: isFollowing });
  } catch (error) {
    console.error('Check follow error:', error);
    res.status(500).json({ error: error.message });
  }
});

// جلب المتاجر التي يتابعها المستخدم
app.get('/api/user/following-stores', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).populate('followingStores');
    res.json(user?.followingStores || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================ Payout Transactions Routes ================

app.get('/api/payouts/transactions', authenticateToken, async (req, res) => {
  try {
    const store = await Store.findOne({ ownerId: req.user.userId });
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }
    
    const transactions = await Transaction.find({ storeId: store._id })
      .populate('orderId', 'orderNumber createdAt')
      .sort({ createdAt: -1 });
    
    const completedTransactions = transactions.filter(t => t.status === 'completed');
    const pendingTransactions = transactions.filter(t => t.status === 'pending');
    const heldTransactions = transactions.filter(t => t.status === 'held');
    
    const stats = {
      totalEarnings: transactions.reduce((sum, t) => sum + (t.sellerAmount || 0), 0),
      availableBalance: completedTransactions.reduce((sum, t) => sum + (t.sellerAmount || 0), 0),
      pendingAmount: pendingTransactions.reduce((sum, t) => sum + (t.sellerAmount || 0), 0),
      heldAmount: heldTransactions.reduce((sum, t) => sum + (t.sellerAmount || 0), 0),
      totalTransactions: transactions.length
    };
    
    res.json({ transactions, stats });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/payouts/withdraw', authenticateToken, async (req, res) => {
  try {
    const { amount, methodId } = req.body;
    
    const store = await Store.findOne({ ownerId: req.user.userId });
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }
    
    const method = await PayoutMethod.findById(methodId);
    if (!method) {
      return res.status(404).json({ error: 'Payout method not found' });
    }
    
    if (method.storeId.toString() !== store._id.toString()) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const completedTransactions = await Transaction.find({ 
      storeId: store._id, 
      status: 'completed' 
    });
    
    const availableBalance = completedTransactions.reduce((sum, t) => sum + (t.sellerAmount || 0), 0);
    
    if (amount <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }
    
    if (amount > availableBalance) {
      return res.status(400).json({ 
        error: `Insufficient balance. Available: ${availableBalance.toLocaleString()} EGP` 
      });
    }
    
    const minPayout = store.paymentSettings?.minimumPayout || 500;
    if (amount < minPayout) {
      return res.status(400).json({ 
        error: `Minimum payout amount is ${minPayout.toLocaleString()} EGP` 
      });
    }
    
    console.log(`💰 Withdrawal request: ${amount} EGP via ${method.type}`);
    
    res.json({ 
      success: true, 
      message: 'Withdrawal request submitted successfully',
      data: {
        amount,
        method: method.type,
        requestId: Date.now(),
        status: 'pending'
      }
    });
    
  } catch (error) {
    console.error('Withdrawal error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ================ Wishlist Routes ================

app.get('/api/wishlist', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).populate('wishlist');
    res.json(user?.wishlist || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/wishlist', authenticateToken, async (req, res) => {
  try {
    const { productId } = req.body;
    const user = await User.findById(req.user.userId);
    if (!user.wishlist) user.wishlist = [];
    if (!user.wishlist.includes(productId)) {
      user.wishlist.push(productId);
      await user.save();
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/wishlist/:productId', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    user.wishlist = user.wishlist.filter(id => id.toString() !== req.params.productId);
    await user.save();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/wishlist/check/:productId', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const isWishlisted = user.wishlist?.includes(req.params.productId) || false;
    res.json({ isWishlisted });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ================ Payment Processing ================


// إنشاء طلب دفع لـ InstaPay
async function createInstaPayPayment(order, storePaymentMethod) {
  try {
    order.paymentDetails = {
      method: 'instapay',
      merchantPhone: storePaymentMethod.mobileWalletDetails?.phoneNumber,
      status: 'pending',
      requestedAt: new Date()
    };
    await order.save();
    
    return {
      requiresAction: true,
      instruction: `Please send ${order.totalAmount} EGP via InstaPay to: ${storePaymentMethod.mobileWalletDetails?.phoneNumber}`,
      merchantPhone: storePaymentMethod.mobileWalletDetails?.phoneNumber,
      amount: order.totalAmount,
      reference: order.orderNumber
    };
  } catch (error) {
    console.error('InstaPay payment error:', error);
    return null;
  }
}

// إنشاء طلب دفع لـ Bank Transfer
async function createBankTransferPayment(order, storePaymentMethod) {
  try {
    order.paymentDetails = {
      method: 'bank',
      bankDetails: storePaymentMethod.bankDetails,
      status: 'pending',
      requestedAt: new Date()
    };
    await order.save();
    
    return {
      requiresAction: true,
      instruction: `Please transfer ${order.totalAmount} EGP to the following bank account:`,
      bankDetails: storePaymentMethod.bankDetails,
      amount: order.totalAmount,
      reference: order.orderNumber
    };
  } catch (error) {
    console.error('Bank transfer payment error:', error);
    return null;
  }
}

// ================ Payment Processing (Production Ready) ================

// تكامل Vodafone Cash API الحقيقي
async function createVodafoneCashPayment(order, storePaymentMethod) {
  try {
    const vodafoneApiUrl = process.env.VODAFONE_CASH_API_URL;
    const apiKey = process.env.VODAFONE_CASH_API_KEY;
    
    if (!vodafoneApiUrl || !apiKey) {
      console.log('⚠️ Vodafone Cash API not configured, using manual instructions');
      // Fallback to manual instructions
      order.paymentDetails = {
        method: 'vodafone_cash',
        merchantPhone: storePaymentMethod.mobileWalletDetails?.phoneNumber,
        status: 'pending',
        requestedAt: new Date()
      };
      await order.save();
      
      return {
        requiresAction: true,
        instruction: `Please send ${order.totalAmount} EGP to Vodafone Cash number: ${storePaymentMethod.mobileWalletDetails?.phoneNumber}`,
        merchantPhone: storePaymentMethod.mobileWalletDetails?.phoneNumber,
        amount: order.totalAmount,
        reference: order.orderNumber
      };
    }
    
    const paymentRequest = {
      merchantId: process.env.VODAFONE_MERCHANT_ID,
      orderId: order.orderNumber,
      amount: order.totalAmount,
      currency: 'EGP',
      customerPhone: order.shippingAddress.phone,
      merchantPhone: storePaymentMethod.mobileWalletDetails?.phoneNumber,
      callbackUrl: `${process.env.BACKEND_URL}/api/webhooks/vodafone-cash`,
      redirectUrl: `${process.env.FRONTEND_URL}/order-tracking/${order.orderNumber}`
    };
    
    const response = await axios.post(vodafoneApiUrl, paymentRequest, {
      headers: { 
        'Authorization': `Bearer ${apiKey}`, 
        'Content-Type': 'application/json' 
      },
      timeout: 10000
    });
    
    order.paymentDetails = {
      method: 'vodafone_cash',
      merchantPhone: storePaymentMethod.mobileWalletDetails?.phoneNumber,
      transactionId: response.data.transactionId,
      status: 'pending',
      requestedAt: new Date(),
      paymentUrl: response.data.paymentUrl
    };
    await order.save();
    
    return {
      requiresAction: true,
      paymentUrl: response.data.paymentUrl,
      transactionId: response.data.transactionId,
      instruction: `Please complete payment via Vodafone Cash`,
      merchantPhone: storePaymentMethod.mobileWalletDetails?.phoneNumber,
      amount: order.totalAmount,
      reference: order.orderNumber
    };
  } catch (error) {
    console.error('Vodafone Cash payment error:', error.message);
    // Fallback to manual instructions
    order.paymentDetails = {
      method: 'vodafone_cash',
      merchantPhone: storePaymentMethod.mobileWalletDetails?.phoneNumber,
      status: 'pending',
      requestedAt: new Date()
    };
    await order.save();
    
    return {
      requiresAction: true,
      instruction: `Please send ${order.totalAmount} EGP to Vodafone Cash number: ${storePaymentMethod.mobileWalletDetails?.phoneNumber}`,
      merchantPhone: storePaymentMethod.mobileWalletDetails?.phoneNumber,
      amount: order.totalAmount,
      reference: order.orderNumber
    };
  }
}

// Webhook لاستقبال تأكيد الدفع من Vodafone Cash
app.post('/api/webhooks/vodafone-cash', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const notification = req.body;
    const { orderNumber, transactionId, status, amount } = notification;
    
    const order = await Order.findOne({ orderNumber });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    if (status === 'completed' || status === 'success') {
      order.paymentStatus = 'paid';
      order.orderStatus = 'confirmed';
      order.paymentDetails.status = 'completed';
      order.paymentDetails.transactionId = transactionId;
      order.paymentDetails.paidAt = new Date();
      await order.save();
      
      // Create transaction for seller
      const storeItems = order.items.reduce((acc, item) => {
        if (!acc[item.storeId]) acc[item.storeId] = [];
        acc[item.storeId].push(item);
        return acc;
      }, {});
      
      for (const [storeId, items] of Object.entries(storeItems)) {
        const storeSubtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
        const platformCommission = storeSubtotal * 0.1;
        const sellerAmount = storeSubtotal - platformCommission;
        
        const transaction = new Transaction({
          orderId: order._id,
          storeId,
          buyerId: order.customerId,
          amount: storeSubtotal,
          platformCommission,
          sellerAmount,
          status: 'pending',
          paymentMethod: 'wallet',
          releaseDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
        });
        await transaction.save();
      }
      
      console.log(`✅ Order ${order.orderNumber} paid via Vodafone Cash`);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});




// ================ Machine Integration (Production Ready) ================

// Send to real machine via TCP
async function sendToTCPMachine(machine, gcode) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('TCP connection timeout'));
    }, 10000);
    
    client.connect(machine.port, machine.ipAddress, () => {
      clearTimeout(timeout);
      client.write(gcode);
      client.end();
      resolve({ success: true, message: 'G-code sent via TCP' });
    });
    
    client.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// Send to real machine via MQTT
async function sendToMQTTMachine(machine, gcode, designId) {
  if (!mqttClient || !mqttClient.connected) {
    throw new Error('MQTT client not connected');
  }
  
  const topic = `${process.env.MQTT_TOPIC_PREFIX}/${machine._id}/gcode`;
  const message = JSON.stringify({
    designId,
    gcode,
    timestamp: new Date().toISOString(),
    machineId: machine._id.toString()
  });
  
  return new Promise((resolve, reject) => {
    mqttClient.publish(topic, message, { qos: 1 }, (err) => {
      if (err) reject(err);
      else resolve({ success: true, message: 'G-code sent via MQTT' });
    });
  });
}

// Main send to machine function
async function sendToRealMachine(machine, gcode, designId) {
  try {
    let result;
    
    switch (machine.protocol) {
      case 'TCP':
        result = await sendToTCPMachine(machine, gcode);
        break;
      case 'MQTT':
        result = await sendToMQTTMachine(machine, gcode, designId);
        break;
      default:
        result = { success: false, message: `Unsupported protocol: ${machine.protocol}` };
    }
    
    return result;
  } catch (error) {
    console.error('Machine communication error:', error);
    return { success: false, message: error.message };
  }
}

// تحديث مسار إرسال التصميم للآلة
app.post('/api/machines/:machineId/send-design', authenticateToken, async (req, res) => {
  try {
    const { designId } = req.body;
    const machine = await Machine.findById(req.params.machineId);
    const design = await Design.findById(designId);
    
    if (!machine || !design) {
      return res.status(404).json({ error: 'Machine or design not found' });
    }
    
    if (design.userId.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    // Generate advanced G-code
    const gcode = await generateAdvancedGCode(design, machine);
    
    // Send to real machine
    const sendResult = await sendToRealMachine(machine, gcode, design._id);
    
    if (sendResult.success) {
      design.status = 'production';
      design.gcode = gcode;
      design.productionStartedAt = new Date();
      await design.save();
      
      const productionLog = new ProductionLog({
        designId: design._id,
        machineId: machine._id,
        userId: req.user.userId,
        status: 'started',
        details: sendResult
      });
      await productionLog.save();
      
      // Publish status via MQTT if available
      if (mqttClient && mqttClient.connected) {
        const statusTopic = `${process.env.MQTT_TOPIC_PREFIX}/${machine._id}/status`;
        mqttClient.publish(statusTopic, JSON.stringify({
          designId: design._id,
          status: 'started',
          timestamp: new Date().toISOString()
        }));
      }
      
      res.json({ 
        success: true, 
        message: 'Design sent to machine successfully',
        gcode: gcode.substring(0, 500) + '...',
        machineResponse: sendResult
      });
    } else {
      throw new Error(sendResult.message);
    }
  } catch (error) {
    console.error('Send to machine error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate advanced G-code
async function generateAdvancedGCode(design, machine) {
  const area = (design.dimensions.width * design.dimensions.height) / 10000;
  const totalStitches = area * (design.pattern.complexity * 1000);
  
  return `
; ============================================
; Naseej AI Generated G-Code - Advanced Version
; ============================================
; Design ID: ${design._id}
; Design Name: ${design.name}
; Dimensions: ${design.dimensions.width}x${design.dimensions.height} cm
; Area: ${area.toFixed(2)} m²
; Total Stitches: ${Math.round(totalStitches).toLocaleString()}
; Machine: ${machine.name} (${machine.type})
; Generated: ${new Date().toISOString()}
; ============================================

; Initialize
G21 ; Set units to mm
G90 ; Absolute positioning
G28 ; Home all axes
G92 X0 Y0 Z0 ; Set current position

; Material Settings
M104 S${getMaterialTemperature(design.material.type)} ; Set temperature
M106 S255 ; Main motor on full speed

; Start weaving pattern
; Primary color: ${design.colors.primary}
; Secondary colors: ${design.colors.secondary.join(', ')}

${generateWeavingPattern(design, machine)}

; Finish
M107 ; Main motor off
M30 ; Program end

; ============================================
; Production Stats
; Estimated Time: ${design.productionTime} hours
; Material Used: ${(area * design.material.weightPerSquareMeter).toFixed(2)} kg
; ============================================
  `;
}

function getMaterialTemperature(materialType) {
  const temps = {
    wool: 180,
    silk: 160,
    cotton: 200,
    polyester: 220,
    blend: 190
  };
  return temps[materialType] || 180;
}

function generateWeavingPattern(design, machine) {
  const width = design.dimensions.width * 10;
  const height = design.dimensions.height * 10;
  const complexity = design.pattern.complexity;
  const step = Math.max(1, Math.floor(100 / complexity));
  
  let gcode = '';
  
  for (let y = 0; y <= height; y += step) {
    if (y % (step * 2) === 0) {
      gcode += `G01 X${width} Y${y} F800\n`;
    } else {
      gcode += `G01 X0 Y${y} F800\n`;
    }
    
    const colorIndex = Math.floor(y / step) % design.colors.secondary.length;
    if (colorIndex === 0 && y > 0) {
      gcode += `; Color change to ${design.colors.secondary[colorIndex] || design.colors.primary}\n`;
      gcode += `M104 S${getMaterialTemperature(design.material.type)}\n`;
    }
  }
  
  return gcode;
}

// Production tracking route
app.get('/api/production/design/:designId', authenticateToken, async (req, res) => {
  try {
    const design = await Design.findById(req.params.designId);
    if (!design) {
      return res.status(404).json({ error: 'Design not found' });
    }
    
    const productionLogs = await ProductionLog.find({ designId: design._id })
      .populate('machineId', 'name type')
      .sort({ startedAt: -1 });
    
    res.json({
      design,
      status: design.status,
      productionLogs,
      estimatedCompletion: design.productionStartedAt ? 
        new Date(design.productionStartedAt.getTime() + design.productionTime * 60 * 60 * 1000) : null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Machine status webhook (from MQTT or direct API)
app.post('/api/webhooks/machine-status', async (req, res) => {
  try {
    const { machineId, designId, status, progress, details } = req.body;
    
    const productionLog = await ProductionLog.findOne({ 
      machineId, 
      designId,
      status: { $in: ['started', 'in_progress'] }
    });
    
    if (!productionLog) {
      return res.status(404).json({ error: 'Production log not found' });
    }
    
    if (status === 'completed') {
      productionLog.status = 'completed';
      productionLog.completedAt = new Date();
      productionLog.progress = 100;
      await productionLog.save();
      
      await Design.findByIdAndUpdate(designId, { 
        status: 'completed',
        completedAt: new Date()
      });
    } else if (status === 'in_progress' && progress) {
      productionLog.status = 'in_progress';
      productionLog.progress = progress;
      productionLog.details = { ...productionLog.details, ...details };
      await productionLog.save();
    } else if (status === 'failed') {
      productionLog.status = 'failed';
      productionLog.details = { ...productionLog.details, error: details };
      await productionLog.save();
      
      await Design.findByIdAndUpdate(designId, { status: 'cancelled' });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Machine webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});





// ================ Social Posts Routes ================

// إنشاء منشور جديد
app.post('/api/posts', authenticateToken, async (req, res) => {
  try {
    const { content, media, hashtags, mentions, visibility, isScheduled, scheduledAt } = req.body;
    
    // التحقق من صحة المحتوى
    if (!content && (!media || media.length === 0)) {
      return res.status(400).json({ error: 'Please add content or media' });
    }
    
    // ✅ التحقق من صحة visibility
    const validVisibility = ['public', 'followers', 'private', 'store_only'];
    const finalVisibility = validVisibility.includes(visibility) ? visibility : 'public';
    
    const post = new Post({
      userId: req.user.userId,
      content: content || '',
      media: media || [],
      hashtags: hashtags || [],
      mentions: mentions || [],
      visibility: finalVisibility,
      isScheduled: isScheduled || false,
      scheduledAt: scheduledAt || null,
      status: isScheduled ? 'draft' : 'published'
    });
    
    await post.save();
    
    // Populate user info للمنشور الجديد مع معلومات المتجر
    const populatedPost = await Post.findById(post._id)
      .populate('userId', 'username email avatar role storeId')
      .populate({
        path: 'userId',
        populate: {
          path: 'storeId',
          model: 'Store',
          select: 'name slug logo'
        }
      });
    
    res.status(201).json({ 
      success: true, 
      post: populatedPost,
      message: isScheduled ? 'Post scheduled successfully' : 'Post created successfully'
    });
  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({ error: error.message });
  }
});

// جلب منشورات مستخدم معين (لصفحة المستخدم الشخصية)
app.get('/api/posts/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    
    // جلب المستخدم
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const currentUserId = req.user?.userId;
    const isOwner = currentUserId === userId;
    
    // جلب منشورات المستخدم
    const query = {
      userId: userId,
      status: 'published',
      isScheduled: false
    };
    
    // ✅ إصلاح: صاحب الحساب يرى كل منشوراته (بما فيها الخاصة والمتابعين)
    // الزائر يرى فقط المنشورات العامة
    if (!isOwner) {
      query.visibility = 'public';
    }
    // إذا كان صاحب الحساب، لا نضيف شرط visibility - يرى كل شيء
    
    const posts = await Post.find(query)
      .populate('userId', 'username email avatar role storeId')
      .populate('likes', 'username')
      .populate({
        path: 'userId',
        populate: {
          path: 'storeId',
          model: 'Store',
          select: 'name slug logo'
        }
      })
      .sort({ isPinned: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    // إضافة معلومات الإعجاب للمستخدم الحالي
    if (currentUserId) {
      for (const post of posts) {
        post.liked = post.likes.some(like => like._id.toString() === currentUserId);
      }
    }
    
    res.json({ 
      posts, 
      page: parseInt(page), 
      hasMore: posts.length === limit,
      total: posts.length,
      user: {
        id: targetUser._id,
        username: targetUser.username,
        email: targetUser.email,
        storeId: targetUser.storeId
      }
    });
  } catch (error) {
    console.error('User posts error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ================ Upload Routes (Enhanced) ================

// رفع صورة واحدة
app.post('/api/upload', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    res.json({
      success: true,
      url: req.file.path,
      publicId: req.file.filename,
      type: 'image'
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// رفع فيديو
app.post('/api/upload/video', authenticateToken, upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video uploaded' });
    }
    
    // التحقق من أن الملف فيديو
    if (!req.file.mimetype.startsWith('video/')) {
      return res.status(400).json({ error: 'File must be a video' });
    }
    
    res.json({
      success: true,
      url: req.file.path,
      publicId: req.file.filename,
      type: 'video',
      duration: req.file.duration || null
    });
  } catch (error) {
    console.error('Video upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// رفع صور متعددة
app.post('/api/upload/multiple', authenticateToken, upload.array('media', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }
    
    const uploadedFiles = req.files.map(file => ({
      type: file.mimetype.startsWith('image/') ? 'image' : 'video',
      url: file.path,
      publicId: file.filename
    }));
    
    res.json({ 
      success: true, 
      files: uploadedFiles,
      count: uploadedFiles.length 
    });
  } catch (error) {
    console.error('Multiple upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// حذف ملف من Cloudinary
app.delete('/api/upload/:publicId', authenticateToken, async (req, res) => {
  try {
    const { publicId } = req.params;
    
    if (!publicId) {
      return res.status(400).json({ error: 'Public ID is required' });
    }
    
    const result = await cloudinary.uploader.destroy(publicId, { invalidate: true });
    
    if (result.result === 'ok') {
      res.json({ success: true, message: 'File deleted successfully' });
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// جلب جميع المنشورات (Feed)
app.get('/api/posts/feed', async (req, res) => {
  try {
    const { page = 1, limit = 20, type = 'for_you' } = req.query;
    const query = { status: 'published', isScheduled: false };
    
    const currentUserId = req.user?.userId;
    let currentUser = null;
    
    if (currentUserId) {
      currentUser = await User.findById(currentUserId);
    }
    
    // ================ For You Feed ================
    if (type === 'for_you') {
      if (currentUser) {
        // للمستخدمين المسجلين:
        // 1. المنشورات العامة (public) من الجميع
        // 2. منشورات المستخدمين الذين يتابعهم (حتى لو كانت followers)
        // 3. منشورات المستخدم نفسه
        
        const followingIds = currentUser.followingStores || [];
        
        query.$or = [
          { visibility: 'public' },                                    // عامة للجميع
          { userId: currentUserId },                                   // منشورات المستخدم نفسه
          { 
            userId: { $in: followingIds },                             // منشورات المتابعين
            visibility: { $in: ['public', 'followers'] }              // عامة أو للمتابعين
          }
        ];
      } else {
        // لغير المسجلين: اعرض فقط المنشورات العامة
        query.visibility = 'public';
      }
    }
    
    // ================ Following Feed ================
    else if (type === 'following') {
      if (!currentUser) {
        return res.json({ posts: [], page: 1, hasMore: false, total: 0 });
      }
      
      const followingIds = currentUser.followingStores || [];
      if (followingIds.length === 0) {
        return res.json({ posts: [], page: 1, hasMore: false, total: 0 });
      }
      
      query.userId = { $in: followingIds };
      query.visibility = { $in: ['public', 'followers'] };
    }
    
    // ================ Trending Feed ================
    else if (type === 'trending') {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      query.createdAt = { $gte: sevenDaysAgo };
      query.visibility = 'public';
    }
    
    // ================ Store Feed ================
    else if (type === 'store' && req.query.storeId) {
      query.storeId = req.query.storeId;
      query.visibility = { $in: ['public', 'followers'] };
    }
    
    // جلب المنشورات مع populate
    let posts = await Post.find(query)
      .populate('userId', 'username email avatar role storeId')
      .populate('likes', 'username')
      .populate({
        path: 'userId',
        populate: {
          path: 'storeId',
          model: 'Store',
          select: 'name slug logo'
        }
      })
      .sort({ isPinned: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    // ================ ترتيب المنشورات الرائجة حسب التفاعل ================
    if (type === 'trending') {
      posts = posts.sort((a, b) => {
        const scoreA = (a.likesCount || 0) * 2 + (a.commentsCount || 0) * 3 + (a.sharesCount || 0) * 1.5;
        const scoreB = (b.likesCount || 0) * 2 + (b.commentsCount || 0) * 3 + (b.sharesCount || 0) * 1.5;
        return scoreB - scoreA;
      });
    }
    
    // ================ تحديث عدد المشاهدات ================
    for (const post of posts) {
      post.viewsCount = (post.viewsCount || 0) + 1;
      await post.save();
    }
    
    // ================ إضافة معلومات إضافية للمستخدم ================
    if (currentUserId) {
      for (const post of posts) {
        post.liked = post.likes.some(like => like._id.toString() === currentUserId);
      }
    }
    
    res.json({ 
      posts, 
      page: parseInt(page), 
      hasMore: posts.length === limit,
      total: posts.length
    });
  } catch (error) {
    console.error('Feed error:', error);
    res.status(500).json({ error: error.message });
  }
});






// جلب منشورات متجر معين
app.get('/api/posts/store/:storeId', async (req, res) => {
  try {
    const { storeId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    
    // جلب المتجر أولاً للتأكد من وجوده
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }
    
    // جلب المستخدم صاحب المتجر
    const owner = await User.findById(store.ownerId);
    if (!owner) {
      return res.status(404).json({ error: 'Store owner not found' });
    }
    
    // جلب منشورات المستخدم التي:
    // 1. مرتبطة بهذا المتجر (storeId موجود)
    // 2. أو منشورات عامة من المستخدم
    const query = {
      userId: owner._id,
      status: 'published',
      isScheduled: false
    };
    
    // إضافة شرط visibility حسب المستخدم الزائر
    const currentUserId = req.user?.userId;
    if (!currentUserId) {
      // لغير المسجلين، اعرض فقط المنشورات العامة
      query.visibility = 'public';
    } else {
      const currentUser = await User.findById(currentUserId);
      const isFollowing = currentUser?.followingStores?.includes(storeId);
      
      // للمستخدمين المسجلين:
      // - المنشورات العامة (public) يراها الجميع
      // - منشورات المتابعين (followers) يراها فقط من يتابع المتجر
      // - المنشورات الخاصة (private) يراها صاحب المتجر فقط
      // - منشورات المتجر فقط (store_only) يراها فقط زوار المتجر
      
      query.$or = [
        { visibility: 'public' },
        { visibility: 'store_only' }
      ];
      
      if (isFollowing) {
        query.$or.push({ visibility: 'followers' });
      }
      
      if (owner._id.toString() === currentUserId) {
        // صاحب المتجر يرى كل منشوراته
        delete query.$or;
      }
    }
    
    const posts = await Post.find(query)
      .populate('userId', 'username email avatar role storeId')
      .populate('likes', 'username')
      .populate({
        path: 'userId',
        populate: {
          path: 'storeId',
          model: 'Store',
          select: 'name slug logo'
        }
      })
      .sort({ isPinned: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    // إضافة معلومات الإعجاب للمستخدم الحالي
    if (currentUserId) {
      for (const post of posts) {
        post.liked = post.likes.some(like => like._id.toString() === currentUserId);
      }
    }
    
    res.json({ 
      posts, 
      page: parseInt(page), 
      hasMore: posts.length === limit,
      total: posts.length,
      store: {
        id: store._id,
        name: store.name,
        slug: store.slug,
        logo: store.logo
      }
    });
  } catch (error) {
    console.error('Store posts error:', error);
    res.status(500).json({ error: error.message });
  }
});

// تحديث visibility منشور
app.put('/api/posts/:postId/visibility', authenticateToken, async (req, res) => {
  try {
    const { visibility } = req.body;
    const post = await Post.findById(req.params.postId);
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    if (post.userId.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const validVisibility = ['public', 'followers', 'private', 'store_only'];
    if (!validVisibility.includes(visibility)) {
      return res.status(400).json({ error: 'Invalid visibility value' });
    }
    
    post.visibility = visibility;
    await post.save();
    
    res.json({ success: true, visibility: post.visibility });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// جلب إحصائيات المستخدم للـ Social Home
app.get('/api/user/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // عدد الإعجابات التي أعطاها المستخدم
    const likedPosts = await Post.countDocuments({ likes: userId });
    const likedComments = await Comment.countDocuments({ likes: userId });
    const totalLikes = likedPosts + likedComments;
    
    // عدد التعليقات التي كتبها المستخدم
    const totalComments = await Comment.countDocuments({ userId });
    
    // عدد المنشورات التي شاركها المستخدم
    const totalShares = await Post.countDocuments({ userId, sharesCount: { $gt: 0 } });
    
    // عدد الأيام النشطة (منذ إنشاء الحساب)
    const user = await User.findById(userId);
    const daysSinceJoined = Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24));
    
    res.json({
      totalLikes,
      totalComments,
      totalShares,
      activeDays: daysSinceJoined || 1
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// جلب منشور واحد
app.get('/api/posts/:postId', async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId)
      .populate('userId', 'username email avatar role storeId')
      .populate('likes', 'username');
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    // زيادة المشاهدات
    post.viewsCount += 1;
    await post.save();
    
    // جلب التعليقات
    const comments = await Comment.find({ postId: post._id, parentId: null })
      .populate('userId', 'username email avatar')
      .populate('likes', 'username')
      .sort({ createdAt: -1 });
    
    res.json({ post, comments });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// الإعجاب بمنشور
app.post('/api/posts/:postId/like', authenticateToken, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    const hasLiked = post.likes.includes(req.user.userId);
    
    if (hasLiked) {
      post.likes = post.likes.filter(id => id.toString() !== req.user.userId);
      post.likesCount -= 1;
    } else {
      post.likes.push(req.user.userId);
      post.likesCount += 1;
      
      // إنشاء إشعار
      if (post.userId.toString() !== req.user.userId) {
        const notification = new Notification({
          userId: post.userId,
          type: 'like',
          actorId: req.user.userId,
          postId: post._id,
          content: `liked your post`
        });
        await notification.save();
      }
    }
    
    await post.save();
    res.json({ success: true, likesCount: post.likesCount, hasLiked: !hasLiked });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// إضافة تعليق
app.post('/api/posts/:postId/comment', authenticateToken, async (req, res) => {
  try {
    const { content, parentId } = req.body;
    const post = await Post.findById(req.params.postId);
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    const comment = new Comment({
      postId: post._id,
      userId: req.user.userId,
      content,
      parentId: parentId || null
    });
    
    await comment.save();
    
    post.commentsCount += 1;
    await post.save();
    
    // إنشاء إشعار
    if (post.userId.toString() !== req.user.userId) {
      const notification = new Notification({
        userId: post.userId,
        type: 'comment',
        actorId: req.user.userId,
        postId: post._id,
        commentId: comment._id,
        content: `commented on your post`
      });
      await notification.save();
    }
    
    const populatedComment = await Comment.findById(comment._id)
      .populate('userId', 'username email avatar');
    
    res.status(201).json({ success: true, comment: populatedComment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// مشاركة منشور
app.post('/api/posts/:postId/share', authenticateToken, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    post.sharesCount += 1;
    await post.save();
    
    // إنشاء منشور مشاركة
    const sharedPost = new Post({
      userId: req.user.userId,
      content: `Shared: ${post.content.substring(0, 100)}...`,
      media: post.media,
      hashtags: post.hashtags,
      visibility: 'public',
      status: 'published'
    });
    await sharedPost.save();
    
    res.json({ success: true, sharesCount: post.sharesCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// حذف منشور
app.delete('/api/posts/:postId', authenticateToken, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    if (post.userId.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    post.status = 'archived';
    await post.save();
    
    res.json({ success: true, message: 'Post deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================ Stories Routes ================

// إنشاء قصة جديدة
app.post('/api/stories', authenticateToken, async (req, res) => {
  try {
    const { media, duration } = req.body;
    
    if (!media || !media.url) {
      return res.status(400).json({ error: 'Media is required' });
    }
    
    const story = new Story({
      userId: req.user.userId,
      media: {
        type: media.type || 'image',
        url: media.url
      },
      duration: duration || 24,
      expiresAt: new Date(Date.now() + (duration || 24) * 60 * 60 * 1000)
    });
    
    await story.save();
    
    const populatedStory = await Story.findById(story._id)
      .populate('userId', 'username email avatar');
    
    res.status(201).json({ success: true, story: populatedStory });
  } catch (error) {
    console.error('Create story error:', error);
    res.status(500).json({ error: error.message });
  }
});


// حذف قصة
app.delete('/api/stories/:storyId', authenticateToken, async (req, res) => {
  try {
    const story = await Story.findById(req.params.storyId);
    
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }
    
    if (story.userId.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    await story.deleteOne();
    res.json({ success: true, message: 'Story deleted' });
  } catch (error) {
    console.error('Delete story error:', error);
    res.status(500).json({ error: error.message });
  }
});


// جلب المنشورات المجدولة
app.get('/api/posts/scheduled', authenticateToken, async (req, res) => {
  try {
    const scheduledPosts = await Post.find({
      userId: req.user.userId,
      isScheduled: true,
      scheduledAt: { $gt: new Date() },
      status: 'draft'
    })
      .populate('userId', 'username email avatar')
      .sort({ scheduledAt: 1 });
    
    res.json(scheduledPosts);
  } catch (error) {
    console.error('Scheduled posts error:', error);
    res.status(500).json({ error: error.message });
  }
});


// جلب القصص
app.get('/api/stories/feed', async (req, res) => {
  try {
    const stories = await Story.find({
      expiresAt: { $gt: new Date() }
    })
      .populate('userId', 'username email avatar')
      .sort({ createdAt: -1 });
    
    // إضافة معلومات عما إذا كان المستخدم قد شاهد القصة
    if (req.user) {
      for (const story of stories) {
        story.viewed = story.views.includes(req.user.userId);
      }
    }
    
    // تجميع القصص حسب المستخدم
    const groupedStories = stories.reduce((acc, story) => {
      const userId = story.userId._id.toString();
      if (!acc[userId]) {
        acc[userId] = {
          user: story.userId,
          stories: [],
          viewed: story.viewed || false
        };
      }
      acc[userId].stories.push(story);
      return acc;
    }, {});
    
    res.json(Object.values(groupedStories));
  } catch (error) {
    console.error('Stories error:', error);
    res.status(500).json({ error: error.message });
  }
});

// مشاهدة قصة
app.post('/api/stories/:storyId/view', authenticateToken, async (req, res) => {
  try {
    const story = await Story.findById(req.params.storyId);
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }
    
    if (!story.views.includes(req.user.userId)) {
      story.views.push(req.user.userId);
      story.viewsCount += 1;
      await story.save();
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================ Notifications Routes ================

// جلب الإشعارات
app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.user.userId })
      .populate('actorId', 'username email avatar')
      .populate('postId', 'content media')
      .sort({ createdAt: -1 })
      .limit(50);
    
    const unreadCount = notifications.filter(n => !n.isRead).length;
    
    res.json({ notifications, unreadCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// تحديث حالة الإشعار
app.put('/api/notifications/:notificationId/read', authenticateToken, async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.notificationId);
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    
    notification.isRead = true;
    await notification.save();
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// تحديث كل الإشعارات كمقروءة
app.put('/api/notifications/read-all', authenticateToken, async (req, res) => {
  try {
    await Notification.updateMany(
      { userId: req.user.userId, isRead: false },
      { isRead: true }
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});




// تحرير رسالة
app.put('/api/chat/messages/:messageId', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { text } = req.body;
    const currentUserId = req.user.userId;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (message.senderId.toString() !== currentUserId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    message.text = text;
    message.isEdited = true;
    await message.save();

    res.json({ success: true, message });
  } catch (error) {
    console.error('Edit message error:', error);
    res.status(500).json({ error: error.message });
  }
});

// الإبلاغ عن رسالة
app.post('/api/chat/messages/:messageId/report', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { reason } = req.body;
    const currentUserId = req.user.userId;

    // تخزين التقرير (يمكن إضافة موديل Reports)
    console.log(`User ${currentUserId} reported message ${messageId}: ${reason || 'No reason'}`);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Report message error:', error);
    res.status(500).json({ error: error.message });
  }
});

// تثبيت محادثة
app.put('/api/chat/conversations/:conversationId/pin', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { isPinned } = req.body;
    const currentUserId = req.user.userId;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (!conversation.participants.includes(currentUserId)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (!conversation.settings) conversation.settings = {};
    conversation.settings.isPinned = isPinned;
    await conversation.save();

    res.json({ success: true });
  } catch (error) {
    console.error('Pin conversation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// كتم محادثة
app.put('/api/chat/conversations/:conversationId/mute', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { isMuted } = req.body;
    const currentUserId = req.user.userId;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (!conversation.participants.includes(currentUserId)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (!conversation.settings) conversation.settings = {};
    conversation.settings.isMuted = isMuted;
    await conversation.save();

    res.json({ success: true });
  } catch (error) {
    console.error('Mute conversation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// تصدير محادثة
app.get('/api/chat/conversations/:conversationId/export', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const currentUserId = req.user.userId;

    const conversation = await Conversation.findById(conversationId)
      .populate('participants', 'username email');
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const messages = await Message.find({ conversationId })
      .populate('senderId', 'username')
      .sort({ createdAt: 1 });

    const exportData = {
      exportedAt: new Date(),
      participants: conversation.participants,
      messages: messages.map(msg => ({
        from: msg.senderId.username,
        text: msg.text,
        timestamp: msg.createdAt,
        isEdited: msg.isEdited || false
      }))
    };

    res.json(exportData);
  } catch (error) {
    console.error('Export conversation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// حذف محادثة بالكامل
app.delete('/api/chat/conversations/:conversationId', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const currentUserId = req.user.userId;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (!conversation.participants.includes(currentUserId)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await Message.deleteMany({ conversationId });
    await Conversation.deleteOne({ _id: conversationId });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete conversation error:', error);
    res.status(500).json({ error: error.message });
  }
});





// ================ Chat Routes ================

// إنشاء محادثة جديدة أو جلب الموجودة
app.post('/api/chat/conversation', authenticateToken, async (req, res) => {
  try {
    const { otherUserId } = req.body;
    const currentUserId = req.user.userId;

    // البحث عن محادثة موجودة
    let conversation = await Conversation.findOne({
      participants: { $all: [currentUserId, otherUserId] }
    }).populate('participants', 'username email avatar storeId');

    if (!conversation) {
      // إنشاء محادثة جديدة
      conversation = new Conversation({
        participants: [currentUserId, otherUserId],
        participantsDetails: [
          { userId: currentUserId, lastReadAt: new Date() },
          { userId: otherUserId, lastReadAt: new Date() }
        ]
      });
      await conversation.save();
      conversation = await Conversation.findById(conversation._id)
        .populate('participants', 'username email avatar storeId');
    }

    res.json({ success: true, conversation });
  } catch (error) {
    console.error('Conversation error:', error);
    res.status(500).json({ error: error.message });
  }
});


// جلب محادثة واحدة
app.get('/api/chat/conversation/:conversationId', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const currentUserId = req.user.userId;

    const conversation = await Conversation.findById(conversationId)
      .populate({
        path: 'participants',
        select: 'username email avatar storeId lastSeen isOnline',
        populate: {
          path: 'storeId',
          model: 'Store',
          select: 'name slug logo'
        }
      });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (!conversation.participants.some(p => p._id.toString() === currentUserId)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const otherParticipant = conversation.participants.find(
      p => p._id.toString() !== currentUserId
    );

    // حساب حالة المستخدم
    const isOnline = otherParticipant?.isOnline || false;
    const lastSeen = otherParticipant?.lastSeen;
    let statusText = '';
    let statusColor = '';

    if (isOnline) {
      statusText = 'Online';
      statusColor = 'text-green-500';
    } else if (lastSeen) {
      const minutesAgo = Math.floor((Date.now() - new Date(lastSeen).getTime()) / (1000 * 60));
      if (minutesAgo < 1) {
        statusText = 'Just now';
        statusColor = 'text-green-500';
      } else if (minutesAgo < 60) {
        statusText = `${minutesAgo} min ago`;
        statusColor = 'text-gray-400';
      } else if (minutesAgo < 1440) {
        const hoursAgo = Math.floor(minutesAgo / 60);
        statusText = `${hoursAgo} hour${hoursAgo > 1 ? 's' : ''} ago`;
        statusColor = 'text-gray-400';
      } else {
        const daysAgo = Math.floor(minutesAgo / 1440);
        statusText = `${daysAgo} day${daysAgo > 1 ? 's' : ''} ago`;
        statusColor = 'text-gray-400';
      }
    } else {
      statusText = 'Offline';
      statusColor = 'text-gray-400';
    }

    const formattedConversation = {
      _id: conversation._id,
      participants: conversation.participants,
      otherUser: {
        _id: otherParticipant?._id,
        username: otherParticipant?.username,
        email: otherParticipant?.email,
        avatar: otherParticipant?.avatar,
        storeId: otherParticipant?.storeId, // ✅ الآن يحتوي على storeId مع populated
        status: {
          isOnline,
          lastSeen,
          text: statusText,
          color: statusColor
        }
      },
      lastMessage: conversation.lastMessage,
      updatedAt: conversation.updatedAt,
      settings: conversation.settings || {}
    };

    res.json({ conversation: formattedConversation });
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: error.message });
  }
});


// جلب جميع محادثات المستخدم
app.get('/api/chat/conversations', authenticateToken, async (req, res) => {
  try {
    const currentUserId = req.user.userId;

    const conversations = await Conversation.find({
      participants: currentUserId,
      isArchived: false
    })
      .populate({
        path: 'participants',
        select: 'username email avatar storeId lastSeen isOnline',
        populate: {
          path: 'storeId',
          model: 'Store',
          select: 'name slug logo'
        }
      })
      .sort({ updatedAt: -1 });

    const formattedConversations = await Promise.all(conversations.map(async (conv) => {
      const otherParticipant = conv.participants.find(
        p => p._id.toString() !== currentUserId
      );
      
      const lastMessage = await Message.findOne({ 
        conversationId: conv._id,
        isDeleted: false,
        deletedFor: { $ne: currentUserId }
      })
        .sort({ createdAt: -1 })
        .select('text senderId createdAt');

      const unreadCount = await Message.countDocuments({
        conversationId: conv._id,
        receiverId: currentUserId,
        isRead: false,
        isDeleted: false,
        deletedFor: { $ne: currentUserId }
      });

      let lastMessageText = '';
      if (lastMessage) {
        if (lastMessage.senderId.toString() === currentUserId) {
          lastMessageText = `You: ${lastMessage.text.substring(0, 50)}${lastMessage.text.length > 50 ? '...' : ''}`;
        } else {
          lastMessageText = `${lastMessage.text.substring(0, 50)}${lastMessage.text.length > 50 ? '...' : ''}`;
        }
      } else {
        lastMessageText = 'No messages yet';
      }

      // ✅ حساب حالة المستخدم (نشط/غير نشط)
      const isUserOnline = otherParticipant?.isOnline || false;
      const lastSeen = otherParticipant?.lastSeen;
      let statusText = '';
      let statusColor = '';

      if (isUserOnline) {
        statusText = 'Online';
        statusColor = 'text-green-500';
      } else if (lastSeen) {
        const minutesAgo = Math.floor((Date.now() - new Date(lastSeen).getTime()) / (1000 * 60));
        if (minutesAgo < 1) {
          statusText = 'Just now';
          statusColor = 'text-green-500';
        } else if (minutesAgo < 60) {
          statusText = `${minutesAgo} min ago`;
          statusColor = 'text-gray-400';
        } else if (minutesAgo < 1440) {
          const hoursAgo = Math.floor(minutesAgo / 60);
          statusText = `${hoursAgo} hour${hoursAgo > 1 ? 's' : ''} ago`;
          statusColor = 'text-gray-400';
        } else {
          const daysAgo = Math.floor(minutesAgo / 1440);
          statusText = `${daysAgo} day${daysAgo > 1 ? 's' : ''} ago`;
          statusColor = 'text-gray-400';
        }
      } else {
        statusText = 'Offline';
        statusColor = 'text-gray-400';
      }

      return {
        _id: conv._id,
        otherUser: {
          _id: otherParticipant?._id,
          username: otherParticipant?.username,
          email: otherParticipant?.email,
          avatar: otherParticipant?.avatar,
          storeId: otherParticipant?.storeId, // ✅ الآن يحتوي على storeId populated
          status: { text: statusText, color: statusColor, isOnline: isUserOnline, lastSeen }
        },
        lastMessage: lastMessageText,
        lastMessageTime: lastMessage?.createdAt || conv.updatedAt,
        unreadCount,
        isTyping: conv.participantsDetails?.find(p => p.userId.toString() === otherParticipant?._id?.toString())?.isTyping || false,
        isPinned: conv.settings?.isPinned || false
      };
    }));

    formattedConversations.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return new Date(b.lastMessageTime) - new Date(a.lastMessageTime);
    });

    res.json({ conversations: formattedConversations });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ error: error.message });
  }
});
// جلب رسائل محادثة معينة
app.get('/api/chat/messages/:conversationId', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const currentUserId = req.user.userId;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (!conversation.participants.includes(currentUserId)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // تحديث آخر قراءة
    const participantDetail = conversation.participantsDetails.find(
      p => p.userId.toString() === currentUserId
    );
    if (participantDetail) {
      participantDetail.lastReadAt = new Date();
      await conversation.save();
    }

    // جلب الرسائل
    const messages = await Message.find({
      conversationId,
      isDeleted: false,
      deletedFor: { $ne: currentUserId }
    })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    // تحديث حالة القراءة للرسائل
    await Message.updateMany(
      {
        conversationId,
        receiverId: currentUserId,
        isRead: false
      },
      { isRead: true, readAt: new Date() }
    );

    res.json({ 
      messages: messages.reverse(),
      hasMore: messages.length === limit,
      page: parseInt(page)
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: error.message });
  }
});

// إرسال رسالة جديدة
app.post('/api/chat/messages', authenticateToken, async (req, res) => {
  try {
    const { conversationId, receiverId, text, type = 'text', mediaUrl = '', replyTo } = req.body;

    const senderId = req.user.userId;

    let convId = conversationId;

    if (!convId) {
      // البحث عن محادثة موجودة
      let conversation = await Conversation.findOne({
        participants: { $all: [senderId, receiverId] }
      });

      if (!conversation) {
        conversation = new Conversation({
          participants: [senderId, receiverId],
          participantsDetails: [
            { userId: senderId, lastReadAt: new Date() },
            { userId: receiverId, lastReadAt: new Date() }
          ]
        });
        await conversation.save();
      }
      convId = conversation._id;
    }

    const message = new Message({
      conversationId: convId,
      senderId,
      receiverId,
      text,
      type,
      mediaUrl,
      isRead: false,
      replyTo: replyTo || null
    });

    await message.save();

    // تحديث آخر رسالة في المحادثة
    await Conversation.findByIdAndUpdate(convId, {
      lastMessage: { text, senderId, sentAt: new Date(), isRead: false, type, mediaUrl },
      updatedAt: new Date(),
      $inc: { unreadCount: 1 }
    });

    const populatedMessage = await Message.findById(message._id)
      .populate('senderId', 'username email avatar storeId')
      .populate('receiverId', 'username email avatar storeId');

    res.status(201).json({ success: true, message: populatedMessage });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: error.message });
  }
});

// تحديث حالة الكتابة
app.post('/api/chat/typing', authenticateToken, async (req, res) => {
  try {
    const { conversationId, isTyping } = req.body;
    const currentUserId = req.user.userId;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const participantDetail = conversation.participantsDetails.find(
      p => p.userId.toString() === currentUserId
    );

    if (participantDetail) {
      participantDetail.isTyping = isTyping;
      participantDetail.typingAt = isTyping ? new Date() : null;
      await conversation.save();
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Typing error:', error);
    res.status(500).json({ error: error.message });
  }
});

// حذف رسالة (للمستخدم فقط)
app.delete('/api/chat/messages/:messageId', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const currentUserId = req.user.userId;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (message.senderId.toString() !== currentUserId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    message.isDeleted = true;
    message.deletedFor.push(currentUserId);
    await message.save();

    res.json({ success: true });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: error.message });
  }
});

// أرشفة محادثة
app.put('/api/chat/conversations/:conversationId/archive', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { isArchived } = req.body;

    await Conversation.findByIdAndUpdate(conversationId, { isArchived });
    res.json({ success: true });
  } catch (error) {
    console.error('Archive error:', error);
    res.status(500).json({ error: error.message });
  }
});



// البحث عن مستخدمين للمحادثة
app.get('/api/chat/search-users', authenticateToken, async (req, res) => {
  try {
    const { q } = req.query;
    const currentUserId = req.user.userId;

    const users = await User.find({
      _id: { $ne: currentUserId },
      $or: [
        { username: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } }
      ]
    })
      .select('username email avatar storeId')
      .limit(20);

    // إضافة معلومات المحادثة الموجودة
    const usersWithConversation = await Promise.all(users.map(async (user) => {
      const conversation = await Conversation.findOne({
        participants: { $all: [currentUserId, user._id] }
      });
      return {
        ...user.toObject(),
        conversationId: conversation?._id || null
      };
    }));

    res.json({ users: usersWithConversation });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ================ Reaction API (أضف هذا) ================
app.post('/api/chat/messages/:messageId/reaction', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { reaction } = req.body;
    const currentUserId = req.user.userId;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // التحقق من أن المستخدم مشارك في المحادثة
    const conversation = await Conversation.findById(message.conversationId);
    if (!conversation.participants.includes(currentUserId)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // إضافة أو إزالة الرد فعل
    if (!message.reactions) message.reactions = {};
    
    if (message.reactions[currentUserId] === reaction) {
      // إزالة الرد فعل
      delete message.reactions[currentUserId];
    } else {
      // إضافة أو تحديث الرد فعل
      message.reactions[currentUserId] = reaction;
    }
    
    await message.save();

    res.json({ success: true, reactions: message.reactions });
  } catch (error) {
    console.error('Reaction error:', error);
    res.status(500).json({ error: error.message });
  }
});





// جلب الوسائط المشتركة في المحادثة
app.get('/api/chat/conversations/:conversationId/media', authenticateToken, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const currentUserId = req.user.userId;
        
        const conversation = await Conversation.findById(conversationId);
        if (!conversation || !conversation.participants.includes(currentUserId)) {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        
        const messages = await Message.find({
            conversationId,
            mediaUrl: { $ne: null, $ne: '' },
            isDeleted: false
        }).select('mediaUrl type createdAt');
        
        const media = messages.map(msg => ({
            url: msg.mediaUrl,
            type: msg.type || 'image',
            createdAt: msg.createdAt
        }));
        
        res.json({ media });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// تحديث إعدادات المحادثة
app.put('/api/chat/conversations/:conversationId/settings', authenticateToken, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const currentUserId = req.user.userId;
        const settings = req.body;
        
        const conversation = await Conversation.findById(conversationId);
        if (!conversation || !conversation.participants.includes(currentUserId)) {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        
        if (!conversation.settings) conversation.settings = {};
        Object.assign(conversation.settings, settings);
        await conversation.save();
        
        res.json({ success: true, settings: conversation.settings });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// جلب إعدادات المحادثة
app.get('/api/chat/conversations/:conversationId/settings', authenticateToken, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const currentUserId = req.user.userId;
        
        const conversation = await Conversation.findById(conversationId);
        if (!conversation || !conversation.participants.includes(currentUserId)) {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        
        res.json({ settings: conversation.settings || {} });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// ================ Health Check ================



// مسار للتحقق من slugs (مؤقت - يمكن حذفه بعد التصحيح)
app.get('/api/debug/store-products/:storeSlug', async (req, res) => {
  try {
    const store = await Store.findOne({ slug: req.params.storeSlug });
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }
    
    const products = await Product.find({ storeId: store._id }, 'name slug');
    
    res.json({
      store: { id: store._id, name: store.name, slug: store.slug },
      products: products.map(p => ({ name: p.name, slug: p.slug })),
      totalProducts: products.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// مسار بسيط لجلب المستخدمين للاختبار (بدون توكن - أزله بعد التصحيح)
app.get('/api/public/users', async (req, res) => {
    try {
        const users = await User.find({}).select('username email _id');
        res.json({ users });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Naseej System API is running!', timestamp: new Date() });
});

// ================ Error Handler ================

app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).json({ error: 'Something went wrong!', message: err.message });
});

// ================ Start Server ================

module.exports = app;

// تصدير الموديلات للاستخدام في مكان آخر (اختياري)
module.exports.User = User;
module.exports.Product = Product;
module.exports.Customer = Customer;
module.exports.Coupon = Coupon;
module.exports.ShippingRate = ShippingRate;
module.exports.Order = Order;
module.exports.Invoice = Invoice;
module.exports.Review = Review;

// التشغيل المحلي فقط (وليس على Vercel)
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📋 API Documentation: http://localhost:${PORT}/api/health`);
  });
}