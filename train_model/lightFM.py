import pandas as pd
import numpy as np
from scipy.sparse import csr_matrix
from sklearn.feature_extraction.text import TfidfVectorizer
from lightfm import LightFM

# --- Step 1: Đọc dữ liệu và tạo cột combined_text ---
df = pd.read_csv('products.csv')

# Giả sử CSV có các cột: Title, Description, Thương hiệu, Model, Chất liệu
def combine_product_text(row):
    text_fields = [
        str(row.get('Title', '')),
        str(row.get('Description', '')),
        str(row.get('Thương hiệu', '')),
        str(row.get('Model', '')),
        str(row.get('Chất liệu', ''))
    ]
    return " ".join(text_fields)

df['combined_text'] = df.apply(combine_product_text, axis=1)
print("Total products:", len(df))

# --- Step 2: Vector hóa với TF-IDF để tạo item features ---
# TfidfVectorizer chuyển đổi văn bản thành các vector số học
vectorizer = TfidfVectorizer(stop_words='english', max_features=5000)
tfidf_matrix = vectorizer.fit_transform(df['combined_text'])
print("TF-IDF matrix shape (products x features):", tfidf_matrix.shape)
# tfidf_matrix là ma trận sparse có kích thước (num_products, num_features)
item_features = tfidf_matrix  # Sử dụng TF-IDF vectors làm item features

# --- Step 3: Tạo dummy interactions matrix ---
# Giả sử chúng ta có 100 người dùng (user IDs: 0 đến 99)
num_users = 100
num_items = df.shape[0]  # số sản phẩm (ví dụ: 5000)
# Tạo một ma trận nhị phân (0/1) ngẫu nhiên với xác suất 5% người dùng tương tác với sản phẩm nào đó
np.random.seed(42)  # đảm bảo tính tái lập
interaction_data = (np.random.rand(num_users, num_items) < 0.05).astype(int)
print("Dummy interactions matrix shape:", interaction_data.shape)
interactions = csr_matrix(interaction_data)

# --- Step 4: Huấn luyện mô hình LightFM ---
# Khởi tạo mô hình LightFM với các tham số:
# loss='warp': sử dụng loss WARP (Weighted Approximate-Rank Pairwise) phù hợp cho bài toán xếp hạng.
# no_components=30: số chiều của không gian latent (vector ẩn) là 30.
# learning_rate=0.05: tốc độ học trong quá trình tối ưu.
model = LightFM(loss='warp', no_components=30, learning_rate=0.05)
# Huấn luyện mô hình trên ma trận tương tác, sử dụng cả item_features để tích hợp nội dung sản phẩm.
model.fit(interactions, item_features=item_features, epochs=30, num_threads=4)

# --- Step 5: Hàm gợi ý sản phẩm cho người dùng ---
def recommend_items(model, user_id, interactions, item_features, num_items=5):
    """
    Dự đoán điểm cho tất cả sản phẩm đối với người dùng user_id và trả về top num_items sản phẩm gợi ý.
    """
    n_items = interactions.shape[1]
    # model.predict trả về điểm dự đoán của user với từng sản phẩm.
    scores = model.predict(user_id, np.arange(n_items), item_features=item_features)
    # Sắp xếp các sản phẩm theo điểm giảm dần
    top_items = np.argsort(-scores)[:num_items]
    return top_items, scores[top_items]

# Ví dụ: Gợi ý cho user có ID 0
user_id = 0
top_items, top_scores = recommend_items(model, user_id, interactions, item_features, num_items=10)
print("Top recommended item indices for user", user_id, ":", top_items)
print("Scores:", top_scores)

# Hiển thị các sản phẩm được gợi ý (chọn các trường Title và Price)
recommended_products = df.iloc[top_items][['Title', 'Price']]
print("Recommended Products for user", user_id, ":")
print(recommended_products)
