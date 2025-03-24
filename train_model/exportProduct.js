const admin = require('firebase-admin');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const serviceAccount = require('../service-account.json'); // Thay bằng đường dẫn file JSON của bạn

// Khởi tạo Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function exportProductsToCSV() {
  try {
    // Truy xuất tất cả tài liệu từ collection 'Products'
    const productsSnapshot = await db.collection("Products").get();
    const products = [];
    
    productsSnapshot.forEach((doc) => {
      let data = doc.data();
      data.id = doc.id; // Lưu lại id của document
      products.push(data);
    });

    console.log(`Đã truy xuất ${products.length} sản phẩm từ Firestore.`);

    // Cấu hình header cho file CSV với các trường cần thiết
    const csvWriter = createCsvWriter({
      path: "products.csv",
      header: [
        { id: "id", title: "ID" },
        { id: "Title", title: "Title" },
        { id: "Description", title: "Description" },
        { id: "IsFeatured", title: "IsFeatured" },
        { id: "Price", title: "Price" },
        { id: "ProductType", title: "ProductType" },
        { id: "Stock", title: "Stock" },
        { id: "brand_id", title: "BrandID" },
        { id: "category_ids", title: "CategoryIDs" },
        { id: "created_at", title: "CreatedAt" },
        { id: "Thương hiệu", title: "Thương hiệu" },
        { id: "SKU", title: "SKU" },
        { id: "Xuất xứ thương hiệu", title: "Xuất xứ thương hiệu" },
        { id: "Xuất xứ", title: "Xuất xứ" },
        { id: "Model", title: "Model" },
        { id: "Kích thước", title: "Kích thước" },
        { id: "Chất liệu", title: "Chất liệu" },
        { id: "Trọng lượng", title: "Trọng lượng" },
        { id: "Quy cách đóng gói", title: "Quy cách đóng gói" },
        { id: "Hướng dẫn sử dụng", title: "Hướng dẫn sử dụng" },
        { id: "images", title: "Images" },
        { id: "shop_id", title: "ShopID" },
        { id: "OtherDetails", title: "OtherDetails" }, // Giữ các field khác trong details dưới dạng JSON
      ],
    });

    // Xử lý dữ liệu: nối các mảng và tách riêng các trường trong details
    const formattedProducts = products.map((prod) => {
      const details = prod.details || {};

      // Tách các trường phổ biến nhất
      const topDetails = {
        "Thương hiệu": details["Thương hiệu"] || "",
        SKU: details["SKU"] || "",
        "Xuất xứ thương hiệu": details["Xuất xứ thương hiệu"] || "",
        "Xuất xứ": details["Xuất xứ"] || "",
        Model: details["Model"] || "",
        "Kích thước": details["Kích thước"] || "",
        "Chất liệu": details["Chất liệu"] || "",
        "Trọng lượng": details["Trọng lượng"] || "",
        "Quy cách đóng gói": details["Quy cách đóng gói"] || "",
        "Hướng dẫn sử dụng": details["Hướng dẫn sử dụng"] || "",
      };

      // Lọc các field còn lại của details và lưu dưới dạng JSON
      const otherDetails = Object.keys(details)
        .filter((key) => !(key in topDetails))
        .reduce((obj, key) => {
          obj[key] = details[key];
          return obj;
        }, {});

      return {
        id: prod.id || "",
        Title: prod.Title || prod.title || "",
        Description: prod.Description || prod.description || "",
        IsFeatured:
          prod.IsFeatured !== undefined
            ? prod.IsFeatured
            : prod.isFeatured !== undefined
            ? prod.isFeatured
            : "",
        Price: prod.Price || prod.price || "",
        ProductType: prod.ProductType || prod.productType || "",
        Stock:
          prod.Stock !== undefined
            ? prod.Stock
            : prod.stock !== undefined
            ? prod.stock
            : "",
        brand_id: prod.brand_id || "",
        // Nếu category_ids là mảng, nối thành chuỗi với dấu "; "
        category_ids: Array.isArray(prod.category_ids)
          ? prod.category_ids.join("; ")
          : prod.category_ids || "",
        // Chuyển timestamp thành ISO string (nếu là đối tượng Timestamp của Firestore)
        created_at:
          prod.created_at && prod.created_at.toDate
            ? prod.created_at.toDate().toISOString()
            : prod.created_at || "",
        // Thêm 10 trường phổ biến nhất từ details
        ...topDetails,
        // Nếu images là mảng, nối các URL với dấu "; "
        images: Array.isArray(prod.images) ? prod.images.join("; ") : prod.images || "",
        shop_id: prod.shop_id || "",
        // Giữ các trường khác trong details dưới dạng JSON
        OtherDetails: Object.keys(otherDetails).length > 0 ? JSON.stringify(otherDetails) : "",
      };
    });

    // Ghi dữ liệu ra file CSV
    await csvWriter.writeRecords(formattedProducts);
    console.log('File CSV "products.csv" đã được tạo thành công.');
  } catch (error) {
    console.error("Lỗi khi xuất dữ liệu:", error);
  }
}

async function analyzeDetailsKeys() {
  const productsRef = db.collection("Products");
  const snapshot = await productsRef.get();

  if (snapshot.empty) {
    console.log("Không có sản phẩm nào trong database.");
    return;
  }

  let keyFrequency = {}; // Lưu tần suất xuất hiện của mỗi key trong details

  snapshot.forEach((doc) => {
    const data = doc.data();
    const details = data.details;

    if (details && typeof details === "object") {
      Object.keys(details).forEach((key) => {
        keyFrequency[key] = (keyFrequency[key] || 0) + 1;
      });
    }
  });

  // Sắp xếp theo số lần xuất hiện (từ cao đến thấp)
  const sortedKeys = Object.entries(keyFrequency)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, count }));

  console.log("📊 Thống kê tần suất xuất hiện của các key trong details:");
  console.table(sortedKeys);
}
// analyzeDetailsKeys()
exportProductsToCSV();
