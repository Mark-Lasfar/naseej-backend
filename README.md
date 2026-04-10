---
title: Naseej Backend API
emoji: 🚀
colorFrom: blue
colorTo: purple
sdk: docker
pinned: false
---

# Naseej Backend API

Backend API for Naseej Integrated Management System.

## API Endpoints

- `GET /api/health` - Health check
- `POST /api/auth/register` - Register user
- `POST /api/auth/login` - Login user
- `GET /api/products` - Get all products
- `GET /api/stores` - Get all stores
- `POST /api/orders` - Create order
- `GET /api/orders/track/:orderNumber` - Track order

## Environment Variables Required

Set these in Space settings:
- `MONGODB_URI`
- `JWT_SECRET`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `FRONTEND_URL`

## API Base URL

`https://MGZON-naseej-backend.hf.space/api`