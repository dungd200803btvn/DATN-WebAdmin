// index.js
const admin = require('firebase-admin');
admin.initializeApp({
  credential: admin.credential.cert(require('./service-account.json')),
});
const db = admin.firestore();
const express = require('express');
const { cosineSimilarity } = require('ml-distance'); // Nếu cần dùng thư viện tính cosine similarity (hoặc tự tính)

// ====================
// Step 1: Extract data from Firestore
// ====================
async function extractUserEvents() {
  const snapshot = await db.collection('user_events').get();
  const events = [];
  snapshot.forEach((doc) => {
    events.push(doc.data());
  });
  return events;
}

// ====================
// Step 2: Preprocess Data
// ====================
function preprocessEvents(events) {
  // Gán trọng số cho event: ví dụ, 'purchase' = 5, 'add_to_cart' = 3, 'navigate_to_product_detail' = 1
  return events.map(event => {
    let weight = 1; // Mặc định 1
    switch (event.event) {
      case 'purchase':
        weight = 5;
        break;
      case 'add_to_cart':
        weight = 3;
        break;
      case 'navigate_to_product_detail':
        weight = 1;
        break;
      // Có thể bổ sung thêm các loại event khác nếu cần
      default:
        weight = 1;
    }
    return {
      user_id: event.user_id,
      product_id: event.product_id,
      weight: weight,
      timestamp: event.timestamp // Nếu cần chuyển đổi, bạn có thể dùng new Date(event.timestamp)
    };
  });
}

// ====================
// Step 3: Build Interaction Matrix
// ====================
function buildInteractionMatrix(processedEvents) {
  // Ma trận dưới dạng đối tượng: { user_id: { product_id: total_weight, ... }, ... }
  const matrix = {};
  processedEvents.forEach(e => {
    if (!matrix[e.user_id]) {
      matrix[e.user_id] = {};
    }
    if (!matrix[e.user_id][e.product_id]) {
      matrix[e.user_id][e.product_id] = 0;
    }
    matrix[e.user_id][e.product_id] += e.weight;
  });
  return matrix;
}

// ====================
// Step 4: Compute Item Similarity Matrix (Item-based CF)
// ====================
function buildProductVectors(matrix) {
  // Chuyển đổi ma trận người dùng - sản phẩm thành các vector cho từng sản phẩm
  const productVectors = {};
  Object.keys(matrix).forEach(user => {
    Object.keys(matrix[user]).forEach(product => {
      if (!productVectors[product]) {
        productVectors[product] = {};
      }
      productVectors[product][user] = matrix[user][product];
    });
  });
  return productVectors;
}

// Hàm tính cosine similarity giữa 2 vector được biểu diễn dưới dạng đối tượng {user: weight, ...}
function computeCosineSimilarity(vecA, vecB) {
  const commonUsers = Object.keys(vecA).filter(user => user in vecB);
  if (commonUsers.length === 0) return 0;
  let dotProduct = 0, normA = 0, normB = 0;
  commonUsers.forEach(user => {
    dotProduct += vecA[user] * vecB[user];
  });
  Object.values(vecA).forEach(val => {
    normA += val * val;
  });
  Object.values(vecB).forEach(val => {
    normB += val * val;
  });
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  return normA && normB ? dotProduct / (normA * normB) : 0;
}

function computeItemSimilarityMatrix(productVectors) {
  const products = Object.keys(productVectors);
  const similarityMatrix = {};
  products.forEach(pid1 => {
    similarityMatrix[pid1] = {};
    products.forEach(pid2 => {
      if (pid1 === pid2) {
        similarityMatrix[pid1][pid2] = 1;
      } else {
        similarityMatrix[pid1][pid2] = computeCosineSimilarity(productVectors[pid1], productVectors[pid2]);
      }
    });
  });
  return similarityMatrix;
}

// ====================
// Step 5: Evaluate Model - Recommend products for a given user
// ====================
function recommendProductsForUser(matrix, similarityMatrix, userId, topN = 5) {
  if (!matrix[userId]) return [];
  const userInteractions = matrix[userId];
  const scores = {};
  
  // Duyệt qua các sản phẩm trong similarityMatrix
  Object.keys(similarityMatrix).forEach(product => {
    // Nếu người dùng đã tương tác với sản phẩm này, bỏ qua
    if (userInteractions[product]) return;
    let scoreSum = 0;
    let simSum = 0;
    // Duyệt qua các sản phẩm mà người dùng đã tương tác
    Object.keys(userInteractions).forEach(interactedProduct => {
      const similarity = similarityMatrix[product][interactedProduct] || 0;
      scoreSum += similarity * userInteractions[interactedProduct];
      simSum += Math.abs(similarity);
    });
    if (simSum > 0) {
      scores[product] = scoreSum / simSum;
    }
  });
  
  // Sắp xếp sản phẩm theo điểm giảm dần và chọn top N
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(entry => entry[0]);
}

// ====================
// Step 6: Deploy Model - Tạo API với Express
// ====================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/recommend/:userId', (req, res) => {
  const userId = req.params.userId;
  const recommendations = recommendProductsForUser(interactionMatrix, itemSimilarityMatrix, userId, 5);
  res.json({ userId, recommendations });
});

// ====================
// Step 7: Monitor and Improve - Đơn giản là log thông tin mô hình
// ====================
function monitorModel() {
  console.log('Monitoring Model:');
  console.log('Interaction Matrix:', JSON.stringify(interactionMatrix, null, 2));
  console.log('Item Similarity Matrix:', JSON.stringify(itemSimilarityMatrix, null, 2));
}

// ====================
// Main pipeline: từ bước 1 đến bước 7
// ====================
let interactionMatrix = {};
let itemSimilarityMatrix = {};

async function main() {
  try {
    console.log('Step 1: Extracting data from Firestore...');
    const events = await extractUserEvents();
    console.log(`Extracted ${events.length} events.`);
    
    console.log('Step 2: Preprocessing data...');
    const processedEvents = preprocessEvents(events);
    console.log('Processed Events:', processedEvents);
    
    console.log('Step 3: Building interaction matrix...');
    interactionMatrix = buildInteractionMatrix(processedEvents);
    console.log('Interaction Matrix:'); 
    console.table(interactionMatrix);
    
    console.log('Step 4: Computing item similarity matrix...');
    const productVectors = buildProductVectors(interactionMatrix);
    itemSimilarityMatrix = computeItemSimilarityMatrix(productVectors);
    console.log('Item Similarity for products');
    console.table(itemSimilarityMatrix);
    console.log('Step 5: Evaluating model - generating recommendations...');
    const sampleUserId = "ZXW9xJFuMUdo52GodVm6R9f7YiB3"; // Ví dụ từ document của bạn
    const recommendations = recommendProductsForUser(interactionMatrix, itemSimilarityMatrix, sampleUserId, 5);
    const recTable = recommendations.map((prodId, index) => ({
        Rank: index + 1,
        "Product ID": prodId
        // Nếu có điểm score, bạn có thể thêm trường Score: ...
      }));
      console.log(`Recommendations for user ${sampleUserId}:`);
      console.table(recTable);
    
    console.log('Step 6: Deploying model as API...');
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
    
    console.log('Step 7: Monitoring model...');
    monitorModel();
    
  } catch (error) {
    console.error('Error in pipeline:', error);
  }
}

main();
