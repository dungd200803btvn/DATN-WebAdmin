// server.js
const express = require('express');
const app = express();
const stripe = require('stripe')('sk_test_51NWF5ZD12fzVndl7FqOQhvQuYISWScyYqb0nDrp7LvcdRzIBJSElNkx4iPa8IjPIHKsJ3nywV3TXi3IyEf9rtq6h00dBhN0cQq'); // Thay 'sk_test_YOUR_SECRET_KEY' bằng Secret Key của bạn trong chế độ test

// Sử dụng middleware để parse JSON
app.use(express.json());

// API endpoint tạo PaymentIntent
app.post('/create-payment-intent', async (req, res) => {
  try {
    // Lấy thông tin từ request body (ví dụ: amount và currency)
    const { amount, currency } = req.body;
    
    // Tạo PaymentIntent với Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,    // Số tiền tính theo đơn vị nhỏ nhất (ví dụ: cents)
      currency: currency // Ví dụ: 'usd' hoặc 'vnd' (nếu hỗ trợ)
    });
    
    // Trả về client secret cho Flutter app
    res.send({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error('Error creating PaymentIntent:', error);
    res.status(500).send({ error: error.message });
  }
});

// Chạy server trên cổng 4242
const PORT = 4242;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
