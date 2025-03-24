const express = require('express');
const admin = require('firebase-admin');

// Kiểm tra sự tồn tại của biến môi trường GOOGLE_CREDENTIALS (không log toàn bộ nội dung để tránh tiết lộ thông tin nhạy cảm)
if (!process.env.GOOGLE_CREDENTIALS) {
  console.error("Environment variable GOOGLE_CREDENTIALS is missing!");
} else {
  console.log("GOOGLE_CREDENTIALS exists.");
}

try {
  // Phân tích JSON từ biến môi trường
  const googleCredentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  // Log thông tin cơ bản để xác nhận (chỉ log client_email thay vì toàn bộ key)
  console.log("Parsed GOOGLE_CREDENTIALS, client_email:", googleCredentials.client_email);

  admin.initializeApp({
    credential: admin.credential.cert(googleCredentials),
  });
  console.log("Firebase Admin initialized successfully.");
} catch (error) {
  console.error("Error initializing Firebase Admin:", error);
}



const db = admin.firestore();
console.log("Firestore database connection initialized.");
const app = express();

// Endpoint trả về top 20 category có nhiều sản phẩm nhất
app.get('/top-categories', async (req, res) => {
  try {
    // 1. Lấy toàn bộ products
    const productSnapshot = await db.collection('Products').get();
    console.log(`Retrieved ${productSnapshot.size} products`);

    // 2. Đếm số lượng sản phẩm cho mỗi category
    const categoryCount = {};
    const categoryImages = {};
    productSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.category_ids && Array.isArray(data.category_ids)) {
        data.category_ids.forEach(catId => {
          if (catId) {
            categoryCount[catId] = (categoryCount[catId] || 0) + 1;
            if(!categoryImages[catId] && data.images && data.images.length > 0) {
              categoryImages[catId] = data.images[0];
          }
        }});
      }
    });

    // 3. Sắp xếp các category_id theo số lượng giảm dần và lấy top 20
    const sortedCategoryIds = Object.keys(categoryCount)
      .sort((a, b) => categoryCount[b] - categoryCount[a])
      .slice(0, 20);

    // 4. Truy vấn bảng Categories theo sortedCategoryIds
    let categories = [];
    const batchSize = 10; // Firestore giới hạn whereIn tối đa 10 phần tử
    for (let i = 0; i < sortedCategoryIds.length; i += batchSize) {
      const batchIds = sortedCategoryIds.slice(i, i + batchSize);
      const categorySnapshot = await db
        .collection('Categories')
        .where(admin.firestore.FieldPath.documentId(), 'in', batchIds)
        .get();

      categorySnapshot.forEach(doc => {
        categories.push({
          id: doc.id,
          ...doc.data(),
          productCount: categoryCount[doc.id],
          categoryImage: categoryImages[doc.id] // Thêm số lượng sản phẩm cho mỗi category
        });
      });
    }

    // Sắp xếp lại các category theo số lượng sản phẩm giảm dần
    categories.sort((a, b) => b.productCount - a.productCount);
    console.log("Successfully fetched top categories.");
    res.json({ topCategories: categories });
  } catch (error) {
    console.error("Error retrieving top categories:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/products-by-category/:categoryId', async (req, res) => {
  try {
    const categoryId = req.params.categoryId;
    const limit = parseInt(req.query.limit) || 20;
    const startAfter = req.query.startAfter;

    let query = db.collection('Products')
      .where('category_ids', 'array-contains', categoryId)
      .orderBy('created_at', 'desc')
      .limit(limit);

    if (startAfter) {
      // Chuyển đổi startAfter thành Date (giả sử startAfter là ISO string)
      const startAfterDate = new Date(startAfter);
      query = query.startAfter(startAfterDate);
    }

    const snapshot = await query.get();

    // Trả về JSON cho mỗi product: thêm id vào dữ liệu
    const products = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Tạo nextPageToken dựa trên trường created_at của document cuối
    const lastDoc = snapshot.docs[snapshot.docs.length - 1];
    const nextPageToken = lastDoc 
      ? lastDoc.data().created_at.toDate().toISOString() 
      : null;

    res.json({ products, nextPageToken });
  } catch (error) {
    console.error('Error fetching products by category:', error);
    res.status(500).json({ error: error.message });
  }
});


const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
