import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# --- Step 1: Đọc dữ liệu từ file CSV đã được xuất ---
df = pd.read_csv('products.csv')

# Kiểm tra một số cột cần thiết có tồn tại không
required_columns = ['Title', 'Description', 'Thương hiệu', 'Model', 'Chất liệu','Xuất xứ thương hiệu','Xuất xứ','OtherDetails']
for col in required_columns:
    if col not in df.columns:
        raise ValueError(f"Cột '{col}' không tồn tại trong file CSV.")

# --- Step 2: Tạo cột combined_text từ các trường có sẵn ---
def combine_product_text(row):
    # Lấy các trường quan trọng từ file CSV
    text_fields = [
        str(row.get('Title', '')),
        str(row.get('Description', '')),
        str(row.get('Thương hiệu', '')),
        str(row.get('Model', '')),
        str(row.get('Chất liệu', '')),
        str(row.get('Xuất xứ thương hiệu', '')),
        str(row.get('Xuất xứ', '')),
        str(row.get('OtherDetails', ''))
    ]
    # Nối các trường lại với nhau thành một chuỗi duy nhất
    return " ".join(text_fields)

# Tạo cột combined_text
df['combined_text'] = df.apply(combine_product_text, axis=1)

# --- Step 3: Vector hóa với TF-IDF ---
vectorizer = TfidfVectorizer(stop_words='english', max_features=5000)
tfidf_matrix = vectorizer.fit_transform(df['combined_text'])
print("TF-IDF Matrix shape:", tfidf_matrix.shape)

# --- Step 4: Tính Cosine Similarity ---
cosine_sim = cosine_similarity(tfidf_matrix, tfidf_matrix)
print("Cosine Similarity Matrix shape:", cosine_sim.shape)

# --- Step 5: Hàm gợi ý sản phẩm ---
def recommend_products(product_index, cosine_sim=cosine_sim, top_n=5):
    """
    Trả về top_n sản phẩm tương tự cho sản phẩm tại product_index.
    """
    # Lấy danh sách các cặp (index, similarity) của sản phẩm tại product_index
    sim_scores = list(enumerate(cosine_sim[product_index]))
    # Sắp xếp theo similarity giảm dần và loại bỏ chính sản phẩm đó (index trùng)
    sim_scores = sorted(sim_scores, key=lambda x: x[1], reverse=True)
    sim_scores = [score for score in sim_scores if score[0] != product_index]
    # Lấy top_n chỉ số sản phẩm tương tự
    top_indices = [i for i, score in sim_scores[:top_n]]
    return top_indices, [cosine_sim[product_index][i] for i in top_indices]

# --- Step 6: Thử nghiệm hàm gợi ý ---
product_idx = 1000  # Ví dụ: chọn sản phẩm tại index 10
recommended_indices, scores = recommend_products(product_idx, top_n=20)
print("Sản phẩm gợi ý (index):", recommended_indices)
print("Điểm tương đồng:", scores)

# Hiển thị kết quả gợi ý cùng với Title và Price
recommended_products = df.iloc[recommended_indices][['Title', 'Price']]
print("Recommended Products:")
print(recommended_products)
