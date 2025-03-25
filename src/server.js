
const express = require('express');
const admin = require('firebase-admin');

// Kiểm tra sự tồn tại của biến môi trường GOOGLE_CREDENTIALS (không log toàn bộ nội dung để tránh tiết lộ thông tin nhạy cảm)
if (!process.env.GOOGLE_CREDENTIALS) {
  console.error("Environment variable GOOGLE_CREDENTIALS is missing!");
} else {
  console.log("GOOGLE_CREDENTIALS exists.");
}

try {
  
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.GOOGLE_CREDENTIALS)),
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


// Lấy top brands theo giới hạn truyền vào (mặc định 20)
app.get('/top-brands', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    // 1. Lấy toàn bộ products
    const productSnapshot = await db.collection('Products').get();
    console.log(`Retrieved ${productSnapshot.size} products`);

    // 2. Đếm số lượng sản phẩm cho mỗi brand
    const brandCount = {};
    productSnapshot.forEach(doc => {
      const data = doc.data();
      const brandId = data.brand_id;
      if (brandId) {
        brandCount[brandId] = (brandCount[brandId] || 0) + 1;
      }
    });

    // 3. Sắp xếp các brand_id theo số lượng giảm dần và lấy top theo giới hạn truyền vào
    const sortedBrandIds = Object.keys(brandCount)
      .sort((a, b) => brandCount[b] - brandCount[a])
      .slice(0, limit);

    // 4. Truy vấn bảng Brands theo sortedBrandIds (sử dụng whereIn với batch)
    let brands = [];
    const batchSize = 10;
    for (let i = 0; i < sortedBrandIds.length; i += batchSize) {
      const batchIds = sortedBrandIds.slice(i, i + batchSize);
      const brandSnapshot = await db
        .collection('Brands')
        .where(admin.firestore.FieldPath.documentId(), 'in', batchIds)
        .get();

      brandSnapshot.forEach(doc => {
        brands.push({
          id: doc.id,
          ...doc.data(),
          productCount: brandCount[doc.id],
        });
      });
    }

    // Sắp xếp lại các brand theo số lượng sản phẩm giảm dần
    brands.sort((a, b) => b.productCount - a.productCount);
    console.log("Successfully fetched top brands.");
    res.json({ topBrands: brands });
  } catch (error) {
    console.error("Error retrieving top brands:", error);
    res.status(500).json({ error: error.message });
  }
});

// Lấy top shops theo giới hạn truyền vào (mặc định 20)
app.get('/top-shops', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    // 1. Lấy toàn bộ products
    const productSnapshot = await db.collection('Products').get();
    console.log(`Retrieved ${productSnapshot.size} products`);

    // 2. Đếm số lượng sản phẩm cho mỗi shop
    const shopCount = {};
    productSnapshot.forEach(doc => {
      const data = doc.data();
      const shop_id = data.shop_id;
      if (shop_id) {
        shopCount[shop_id] = (shopCount[shop_id] || 0) + 1;
      }
    });

    // 3. Sắp xếp các brand_id theo số lượng giảm dần và lấy top theo giới hạn truyền vào
    const sortedShopIds = Object.keys(shopCount)
      .sort((a, b) => shopCount[b] - shopCount[a])
      .slice(0, limit);

    // 4. Truy vấn bảng Brands theo sortedBrandIds (sử dụng whereIn với batch)
    let shops = [];
    const batchSize = 10;
    for (let i = 0; i < sortedShopIds.length; i += batchSize) {
      const batchIds = sortedShopIds.slice(i, i + batchSize);
      const shopSnapshot = await db
        .collection('Shops')
        .where(admin.firestore.FieldPath.documentId(), 'in', batchIds)
        .get();

        shopSnapshot.forEach(doc => {
          shops.push({
          id: doc.id,
          ...doc.data(),
          productCount: shopCount[doc.id],
        });
      });
    }

    // Sắp xếp lại các shop theo số lượng sản phẩm giảm dần
    shops.sort((a, b) => b.productCount - a.productCount);
    console.log("Successfully fetched top shops.");
    res.json({ topShops: shops });
  } catch (error) {
    console.error("Error retrieving top shops:", error);
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

app.get('/products-by-brand/:brandId', async (req, res) => {
  try {
    const brandId = req.params.brandId;
    const limit = parseInt(req.query.limit) || 20;
    const startAfter = req.query.startAfter;

    let query = db.collection('Products')
      .where('brand_id', '==', brandId)
      .orderBy('created_at', 'desc')
      .limit(limit);

    if (startAfter) {
      // Giả sử startAfter là ISO string, chuyển nó thành Date
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
    console.error('Error fetching products by brand:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/products-by-shop/:shopId', async (req, res) => {
  try {
    const shopId = req.params.shopId;
    const limit = parseInt(req.query.limit) || 20;
    const startAfter = req.query.startAfter;

    let query = db.collection('Products')
      .where('shop_id', '==', shopId)
      .orderBy('created_at', 'desc')
      .limit(limit);

    if (startAfter) {
      // Giả sử startAfter là ISO string, chuyển đổi thành Date
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
    console.error('Error fetching products by shop:', error);
    res.status(500).json({ error: error.message });
  }
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
