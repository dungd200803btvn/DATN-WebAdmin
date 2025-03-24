// index.js
const admin = require('firebase-admin');
const cron = require('node-cron');
const fs = require('fs');
const axios = require('axios');
const { google } = require('googleapis');
const { performance } = require('perf_hooks');
const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
// Khởi tạo Firebase Admin sử dụng thông tin xác thực từ file JSON
admin.initializeApp({
  credential: admin.credential.cert(require('./service-account.json')),
});
const db = admin.firestore();
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
// Đọc checkpoint từ file JSON
function getLastProcessedIndex() {
  try {
      const data = fs.readFileSync('progress.json', 'utf8');
      return JSON.parse(data).lastIndex || 0;
  } catch (err) {
      return 0; // Nếu chưa có file, bắt đầu từ đầu
  }
}

// Lưu checkpoint vào file JSON
function saveLastProcessedIndex(index) {
  fs.writeFileSync('progress.json', JSON.stringify({ lastIndex: index }), 'utf8');
}


// Đọc project ID từ biến môi trường hoặc dùng giá trị mặc định
const projectId = process.env.FIREBASE_PROJECT_ID || 'da-gr1';
// Phạm vi để uỷ quyền cho FCM
const SCOPES = ['https://www.googleapis.com/auth/firebase.messaging'];

async function deleteDeliveryNotifications(userId) {
  try {
      const notificationsRef = db.collection("User").doc(userId).collection("notifications");
      const snapshot = await notificationsRef.where("type", "==", "delivery").get();

      if (snapshot.empty) {
          console.log(`Không có thông báo "delivery" nào cho user ${userId}.`);
          return;
      }

      // Xóa từng document trong collection
      const batch = db.batch();
      snapshot.forEach(doc => {
          batch.delete(doc.ref);
      });

      await batch.commit();
      console.log(`Đã xóa ${snapshot.size} thông báo "delivery" cho user ${userId}.`);
  } catch (error) {
      console.error(`Lỗi khi xóa thông báo "delivery" cho user ${userId}:`, error);
  }
}

async function updateOrder(userId) {
  try {
      const notificationsRef = db.collection("User").doc(userId).collection("Orders");
      const snapshot = await notificationsRef.get();
      for(const doc of snapshot.docs){
        await doc.ref.update({ notificationSent: false });
      }
      
      console.log(`Đã update ${snapshot.size} trang thai order cho user ${userId}.`);
  } catch (error) {
      console.error(`Lỗi  cho user ${userId}:`, error);
  }
}


async function getAccessToken() {
  const serviceAccount = require('./service-account.json');
  const jwtClient = new google.auth.JWT(
    serviceAccount.client_email,
    null,
    serviceAccount.private_key,
    SCOPES,
    null
  );
  return new Promise((resolve, reject) => {
    jwtClient.authorize((err, tokens) => {
      if (err) {
        reject(err);
      } else {
        resolve(tokens.access_token);
      }
    });
  });
}

/**
 * Hàm gửi thông báo cho các đơn hàng có deliveryDate đã đến và chưa gửi thông báo.
 * Truy vấn sử dụng collectionGroup cho subcollection "Orders" trong cấu trúc:
 * User/{userId}/Orders/{orderId}
 */
async function sendDeliveryNotifications() {
  const now = admin.firestore.Timestamp.now();
  try {
    // Khai báo ordersSnapshot bằng từ khóa const
    const ordersSnapshot = await db.collectionGroup('Orders')
      .where('deliveryDate', '>=', now)
      .where('notificationSent', '==', false)
      .get();

    if (ordersSnapshot.empty) {
      console.log('Không có đơn hàng nào cần gửi thông báo.');
      return;
    }

    for (const doc of ordersSnapshot.docs) {
      const orderData = doc.data();
      const orderId = doc.id;

      // Lấy userId từ đường dẫn: User/{userId}/Orders/{orderId}
      if (!doc.ref.parent || !doc.ref.parent.parent) {
        console.error(`Cấu trúc không hợp lệ cho order ${orderId}`);
        continue;
      }
      const userId = doc.ref.parent.parent.id;

      // Lấy thông tin người dùng từ collection "User"
      const userDoc = await db.collection('User').doc(userId).get();
      if (!userDoc.exists) {
        console.log(`Không tìm thấy người dùng với userId: ${userId}`);
        continue;
      }
      const userData = userDoc.data();
      const fcmToken = userData.FcmToken;
      if (!fcmToken) {
        console.log(`User ${userId} không có FCM token`);
        continue;
      }

      const deliveryTimestamp = orderData.deliveryDate; // Firestore Timestamp
      const deliveryDate = deliveryTimestamp.toDate(); // Chuyển sang JavaScript Date object
      const formattedDate = `${String(deliveryDate.getDate()).padStart(2, '0')}/` +
                      `${String(deliveryDate.getMonth() + 1).padStart(2, '0')}/` +
                      `${deliveryDate.getFullYear()} ` +
                      `${String(deliveryDate.getHours()).padStart(2, '0')}:` +
                      `${String(deliveryDate.getMinutes()).padStart(2, '0')}`;

      // Tạo notification model (theo quy trình client)
      const notificationData = {
        title: 'Đơn hàng giao thành công',
        message: `Đơn hàng ${orderId} của bạn đã được giao thành công vào lúc ${formattedDate}`,
        timestamp: admin.firestore.Timestamp.now(),
        type: 'delivery',
        orderId: orderId,
        imageUrl: orderData.imageUrl || '',
        read: false,
      };

    
      // Xây dựng payload gửi FCM theo định dạng HTTP v1 API
      const messagePayload = {
        message: {
          token: fcmToken,
          notification: {
            title: notificationData.title,
            body: notificationData.message,
          },
          data: {
            id: notificationData.id,
            type: notificationData.type,
            orderId: orderId,
          },
        },
      };

      try {
        const accessToken = await getAccessToken();
        const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
        const response = await axios.post(url, messagePayload, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
        });
        console.log(`Push notification gửi thành công đến user ${userId}:`, response.data);
      
        // Đánh dấu đơn hàng đã được gửi thông báo
        await doc.ref.update({ notificationSent: true });
          // Lưu notification vào subcollection "notifications" của user
      const notificationsRef = db.collection('User').doc(userId).collection('notifications');
      const notificationDoc = await notificationsRef.add(notificationData);
      await notificationDoc.update({ id: notificationDoc.id });
      console.log(`Notification ${notificationDoc.id} đã được lưu cho user ${userId}.`);
      } catch (error) {
        console.error(`Lỗi gửi push notification cho order ${orderId} của user ${userId}:`,
          error.response ? error.response.data : error);
        // Nếu token không hợp lệ, xóa token cũ khỏi Firestore
        if (error.response && error.response.data && error.response.data.error) {
          const err = error.response.data.error;
          if (err.code === 401 || err.message.includes('registration-token-not-registered')) {
            console.log(`FCM token của user ${userId} không hợp lệ, xóa token cũ.`);
            await db.collection('User').doc(userId).update({
              fcmToken: admin.firestore.FieldValue.delete(),
            });
          }
        }
      }
    }
  } catch (error) {
    console.error('Lỗi truy vấn đơn hàng:', error);
  }
}

// Hàm gửi thông báo về voucher cho người dùng đã thu thập nhưng chưa sử dụng
async function sendVoucherNotificationsForUser(userId) {
  try {
    // Truy vấn các voucher đã được user thu thập (claimed_vouchers) mà chưa sử dụng và chưa được thông báo (nếu cần)
    const claimedRef = db.collection('User').doc(userId).collection('claimed_vouchers');
    const claimedSnapshot = await claimedRef.where('is_used', '==', false).get();

    if (claimedSnapshot.empty) {
      console.log(`User ${userId} không có voucher chưa sử dụng.`);
      return;
    }

    // Lặp qua từng voucher được thu thập
    for (const claimDoc of claimedSnapshot.docs) {
      const claimData = claimDoc.data();
      // // Nếu bạn muốn tránh gửi thông báo lặp lại, kiểm tra trường notified (nếu đã có)
      // if (claimData.notified === true) continue;
      
      const voucherId = claimData.voucher_id;
      if (!voucherId) {
        console.log(`Document claimed_vouchers ${claimDoc.id} không có voucher_id`);
        continue;
      }
      
      // Truy vấn thông tin voucher từ collection 'voucher'
      const voucherDoc = await db.collection('voucher').doc(voucherId).get();
      if (!voucherDoc.exists) {
        console.log(`Voucher ${voucherId} không tồn tại`);
        continue;
      }
      const voucherData = voucherDoc.data();
      const notiTitle =   "Voucher chưa sử dụng: " +voucherData.title;
      const notiMessage = voucherData.description || "";

      // Tạo notification model cho voucher
      const notificationData = {
        title: notiTitle,
        message: notiMessage,
        timestamp: admin.firestore.Timestamp.now(),
        type: 'voucher',
        read: false
      };

      

      // Lấy FCM token của user từ collection 'User'
      const userDoc = await db.collection('User').doc(userId).get();
      if (!userDoc.exists) {
        console.log(`Không tìm thấy thông tin người dùng với userId: ${userId}`);
        continue;
      }
      const userData = userDoc.data();
      const fcmToken = userData.FcmToken;
      if (!fcmToken) {
        console.log(`User ${userId} không có FCM token`);
        continue;
      }

      // Xây dựng payload gửi FCM theo định dạng HTTP v1 API
      const messagePayload = {
        message: {
          token: fcmToken,
          notification: {
            title: notiTitle,
            body: notiMessage,
          },
          data: {
            id: notificationData.id,
            type: 'voucher',
            voucher_id: voucherId,
          },
        },
      };

      try {
        const accessToken = await getAccessToken();
        const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
        const response = await axios.post(url, messagePayload, {
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`,
          },
        });
        console.log(`Push notification cho voucher ${voucherId} gửi thành công đến user ${userId}:`, response.data);
        // Lưu thông báo vào subcollection "notifications" của user
      const notificationsRef = db.collection('User').doc(userId).collection('notifications');
      const notificationDoc = await notificationsRef.add(notificationData);
      await notificationDoc.update({ id: notificationDoc.id });
      console.log(`Notification ${notificationDoc.id} cho voucher ${voucherId} đã được lưu cho user ${userId}.`);
      } catch (error) {
        console.error(`Lỗi gửi push notification cho voucher ${voucherId} của user ${userId}:`,
          error.response ? error.response.data : error);
      }

      // // Đánh dấu voucher đã được thông báo để không gửi lại
      // await claimDoc.ref.update({ notified: true });
    }
  } catch (error) {
    console.error(`Lỗi khi truy vấn claimed_vouchers cho user ${userId}:`, error);
  }
}


// Lên lịch chạy hàm sendDeliveryNotifications mỗi 5 phút
// cron.schedule('*/5 * * * *', () => {
  
// });
console.log('Backend scheduler đang chạy...');


async function scrapeTikiImages(url) {
  let options = new chrome.Options();
  options.addArguments('headless'); // Chạy trình duyệt ở chế độ không giao diện
  let driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();

  let finalImageUrls = [];
  try {
    await driver.get(url);
    await driver.wait(until.elementLocated(By.css('a[data-view-id="pdp_main_view_photo"]')), 60000);
    const aElements = await driver.findElements(By.css('a[data-view-id="pdp_main_view_photo"]'));

    let imageUrlsSet = new Set(); // Sử dụng Set để loại bỏ các URL trùng lặp

    for (const aElement of aElements) {
      try {
        const imgElement = await aElement.findElement(By.css('img'));
        const imgSrc = await imgElement.getAttribute('src');
        if (imgSrc.includes("200x280")) { // Lấy ảnh có kích thước 200x280
          imageUrlsSet.add(imgSrc);
        }
      } catch (err) {
        // Nếu không tìm thấy phần tử img, bỏ qua
      }
      try {
        const sourceElement = await aElement.findElement(By.css('source'));
        const sourceSrcset = await sourceElement.getAttribute('srcset');
        const srcsetUrls = sourceSrcset.split(',').map(item => item.trim().split(' ')[0]);
        srcsetUrls.forEach(url => {
          if (url.includes("200x280")) {
            imageUrlsSet.add(url);
          }
        });
      } catch (err) {
        // Nếu không tìm thấy phần tử source, bỏ qua
      }
    }
    finalImageUrls = Array.from(imageUrlsSet).slice(0, 15); // Lấy tối đa 8 ảnh đầu tiên
  } catch (err) {
    console.error("Lỗi khi lấy ảnh từ URL:", err);
  } finally {
    await driver.quit();
  }
  return finalImageUrls;
}
  
  /**
   * Hàm parse file txt thành mảng các object JSON.
   * File txt chứa các object JSON nối liền nhau nên cần sửa lại chuỗi thành một mảng JSON hợp lệ.
   * @param {string} filePath - Đường dẫn file txt.
   * @returns {Array<Object>} - Mảng các object product.
   */
  function parseTxtFile(filePath) {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      // Thay thế các chuỗi "}{", thêm dấu phẩy và bọc trong dấu ngoặc vuông
      const fixedContent = '[' + fileContent.replace(/}\s*{/g, '},{') + ']';
      return JSON.parse(fixedContent);
    } catch (err) {
      console.error("Lỗi khi parse file:", err);
      return [];
    }
  }
  
  /**
   * Hàm lấy hoặc tạo mới document trong collection 'shops' dựa trên tên cửa hàng.
   * @param {string} shopName - Tên cửa hàng.
   * @returns {Promise<string>} - shop_id (document ID).
   */
  async function getOrCreateShop(shopName) {
    const shopsRef = db.collection('Shops');
    const snapshot = await shopsRef.where('shop_name', '==', shopName).get();

    if (!snapshot.empty) {
        return snapshot.docs[0].id;
    } else {
        // Tạo document với ID tự động, sau đó cập nhật `shop_id`
        const newDocRef = shopsRef.doc(); // Lấy một document reference với ID mới
        await newDocRef.set({
            shop_id: newDocRef.id,  // Lưu ID vào document
            shop_name: shopName
        });
        return newDocRef.id;
    }
}
  
  /**
   * Hàm lấy hoặc tạo mới document trong collection 'categories' dựa trên tên danh mục.
   * @param {string} categoryName - Tên danh mục.
   * @returns {Promise<string>} - category_id (document ID).
   */
  async function getOrCreateCategory(categoryName) {
    const categoriesRef = db.collection('Categories');
    const snapshot = await categoriesRef.where('Name', '==', categoryName).get();
    if (!snapshot.empty) {
      return snapshot.docs[0].id;
    } else {
      const newDoc = await categoriesRef.add({ Name: categoryName,IsFeatured: false });
      return newDoc.id;
    }
  }
  
  /**
   * Hàm lấy hoặc tạo mới document trong collection 'brands' dựa trên tên thương hiệu.
   * @param {string} brandName - Tên thương hiệu.
   * @returns {Promise<string>} - brand_id (document ID).
   */
  async function getOrCreateBrand(brandName) {
    const brandsRef = db.collection('Brands');
    const snapshot = await brandsRef.where('Name', '==', brandName).get();
    if (!snapshot.empty) {
      return snapshot.docs[0].id;
    } else {
      const newDoc = await brandsRef.add({ Name: brandName,IsFeatured: false,ProductsCount: randomInt(100, 1000) });
      await newDoc.update({ id: newDoc.id });
      return newDoc.id;
    }
  }
  
  /**
   * Hàm chính thực hiện các bước:
   * 1. Parse file txt chứa dữ liệu sản phẩm.
   * 2. Với mỗi sản phẩm:
   *    - Lấy URL ảnh bằng Selenium.
   *    - Xử lý shop, category, brand (nếu có) và lưu vào Firestore.
   *    - Tạo document product với các trường cần thiết và lưu vào collection 'products'.
   */
  async function processProducts() {
    // 1. Parse file txt (đường dẫn file: 'products.txt')
    const productsData = parseTxtFile('tiki_data.txt'); // Điều chỉnh đường dẫn file nếu cần
    const batchSize = 1;
    const totalProducts = productsData.length;
    console.log(`Tổng số sản phẩm cần xử lý: ${totalProducts}`);
    console.log(`⏳ Bắt đầu xử lý sản phẩm...`);
    let startIndex = getLastProcessedIndex()> 0 ? getLastProcessedIndex() : 0;
    console.log(`Bắt đầu từ sản phẩm STT: ${startIndex+1}`);
    for(let i=startIndex;i<totalProducts;i+=batchSize){
    
      const batchStartIndex = i;
      const batchEndIndex = Math.min(i + batchSize, totalProducts);
      const startSTT = productsData[batchStartIndex]["STT"];
      console.log(`⏩ Bắt đầu xử lý batch từ sản phẩm STT: ${startSTT}`);
      const startTime = performance.now();
      for(let j  =batchStartIndex;j<batchEndIndex;j++){
        const productData = productsData[j];
        try {
          // Lấy danh sách URL ảnh từ trường URL của sản phẩm
          const url = productData["URL"];
          const images = await scrapeTikiImages(url);
    
          // Xử lý shop
          const shopName = productData["Cua hang"];
          const shop_id = await getOrCreateShop(shopName);
    
          // Xử lý danh mục (Chuyen muc)
          const categoryNames = productData["Chuyen muc"] || [];
          let category_ids = [];
          for (const catName of categoryNames) {
            const catId = await getOrCreateCategory(catName);
            category_ids.push(catId);
          }
    
          // Xử lý brand từ "Chi tiet SP" nếu có key "Thương hiệu"
          let brand_id = null;
          const details = productData["Chi tiet SP"] || {};
          if (details["Thương hiệu"]) {
            brand_id = await getOrCreateBrand(details["Thương hiệu"]);
          }
    
          // Tạo model product với các trường cần thiết
          const product = {
            Title: productData["Ten SP"],
            Price: productData["Gia tien"],
            Description: productData["Mo ta SP"],
            details: details,
            shop_id: shop_id,
            category_ids: category_ids,
            images: images,
            created_at: admin.firestore.Timestamp.now(),
            brand_id: brand_id,
            IsFeatured: false,
            ProductType: "ProductType.single",
            Stock: randomInt(100, 1000),
          };
    
          // Lưu product vào collection 'products'
          await db.collection('Products').add(product);
          console.log(`Đã xử lý sản phẩm STT: ${productData["STT"]}`);
          console.log("Chi tiết sản phẩm:", JSON.stringify(product, null, 2));
  
        } catch (err) {
          console.error(`Lỗi khi xử lý sản phẩm STT: ${productData["STT"]}`, err);
        }
      }
      saveLastProcessedIndex(batchEndIndex);
      const endTime = performance.now();
      console.log(`⏱ Thời gian xử lý batch (STT: ${startSTT} ): ${((endTime - startTime)/1000).toFixed(2)} giây`);
    }
    
  }

  async function deleteProductsWithEmptyImagesOrBrand() {
    try {
      const productsRef = db.collection('Products');
      const snapshot = await productsRef.get();
      
      if (snapshot.empty) {
        console.log('No products found.');
        return;
      }
      
      const batch = db.batch();
      
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        const images = data.images;
        const brandId = data.brand_id;  // Lưu ý: tên trường phải khớp với Firestore
        
        // Kiểm tra điều kiện:
        // - images là null hoặc không tồn tại hoặc là mảng rỗng
        // - brand_id là null, không tồn tại hoặc là chuỗi rỗng
        if ((!images || (Array.isArray(images) && images.length === 0)) ||
            (!brandId || (typeof brandId === 'string' && brandId.trim() === ''))) {
          console.log(`Deleting document ${doc.id}`);
          batch.delete(doc.ref);
        }
      });
      
      await batch.commit();
      console.log('Finished deleting documents meeting the criteria.');
    } catch (error) {
      console.error('Error deleting products:', error);
    }
  }
  
  deleteProductsWithEmptyImagesOrBrand();
  
  // // Chạy hàm chính
  // processProducts()
  //   .then(() => {
  //     console.log("Tất cả sản phẩm đã được xử lý thành công.");
  //     process.exit(0);
  //   })
  //   .catch((err) => {
  //     console.error("Lỗi trong quá trình xử lý sản phẩm:", err);
  //     process.exit(1);
  //   }); 

