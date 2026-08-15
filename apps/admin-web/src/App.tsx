import { useEffect, useState } from "react";
import type { Product } from "@soysu/shared";

function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/products")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<Product[]>;
      })
      .then(setProducts)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <main className="container">
      <h1>Soysu Admin</h1>

      {error && <p className="error">Gagal memuat data: {error}</p>}

      <h2>Produk</h2>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Nama</th>
            <th>Rasa</th>
            <th>Harga</th>
            <th>Stok</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id}>
              <td>{product.id}</td>
              <td>{product.name}</td>
              <td>{product.flavor}</td>
              <td>Rp {product.price.toLocaleString("id-ID")}</td>
              <td>{product.stock}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

export default App;
