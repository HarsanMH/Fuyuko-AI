# Fuyuko AI PWA

Aplikasi PWA chat AI khusus Minecraft Bedrock Add-On. Frontend dilayani oleh FastAPI yang sama dengan backend, sehingga tidak memerlukan konfigurasi CORS.

## Isi folder

- `main.py`: backend FastAPI; API key hanya dibaca dari environment variable server.
- `static/`: antarmuka PWA, CSS, JavaScript, manifest, service worker, ikon.
- `knowledge/minecraft_rules.txt`: instruksi pengetahuan tambahan untuk AI.
- `requirements.txt`: dependensi Python.
- `render.yaml`: template konfigurasi deploy Render.

## Jalankan lokal

Perlu Python 3.11+.

```bash
python -m venv .venv
```

Aktifkan virtual environment sesuai sistem operasi, lalu:

```bash
pip install -r requirements.txt
```

Set environment variables di terminal (jangan masukkan key ke frontend):
- `GEMINI_API_KEY`: API key dari Google AI Studio.
- `APP_ACCESS_PASSWORD`: kode akses yang kamu pilih untuk membatasi penggunaan aplikasi.
- `GEMINI_MODEL`: opsional, default `gemini-2.5-flash`.

Jalankan:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

PWA perlu HTTPS agar dapat dipasang dengan baik; `localhost` juga biasanya dianggap secure context saat pengembangan.

## Deploy lewat Render dari HP Android

1. Buat repository GitHub baru dan upload isi folder proyek ini (bukan file ZIP sebagai satu file).
2. Buka https://dashboard.render.com/ dan pilih **New + → Blueprint** atau **New + → Web Service**.
3. Hubungkan repository GitHub tersebut.
4. Jika menggunakan Web Service, set:
   - Runtime: Python
   - Build command: `pip install -r requirements.txt`
   - Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Pada menu Environment, tambahkan:
   - `GEMINI_API_KEY` = API key dari Google AI Studio
   - `APP_ACCESS_PASSWORD` = kode akses panjang yang hanya kamu bagikan ke orang yang dipercaya
   - `GEMINI_MODEL` = `gemini-2.5-flash` (atau model yang tersedia pada akunmu)
6. Deploy, lalu buka URL HTTPS `*.onrender.com` dari Chrome Android.
7. Di Chrome, buka menu ⋮ → **Tambahkan ke layar utama** atau **Install app**.

Render free web services dapat tidur setelah tidak aktif, jadi pembukaan pertama setelah beberapa waktu bisa lambat. Paket/kuota layanan dapat berubah.

## Keamanan penting

- Jangan pernah menaruh `GEMINI_API_KEY` di `static/app.js`, `index.html`, atau repository.
- Jangan commit `.env` atau key rahasia.
- `APP_ACCESS_PASSWORD` adalah perlindungan dasar agar endpoint tidak terbuka untuk semua orang. Gunakan kode yang panjang dan jangan bagikan secara publik.
- Rate limit sederhana disimpan di memori proses; ini bukan perlindungan tingkat produksi terhadap penyalahgunaan berat. Jika aplikasi dipublikasikan luas, tambahkan autentikasi pengguna, batas biaya/kuota provider, dan rate limit terdistribusi.
- Jangan masukkan data pribadi atau rahasia ke chat yang di-host publik.

## Batasan versi awal

- Riwayat chat hanya selama halaman berjalan; belum ada akun atau sinkronisasi.
- Pengetahuan khusus dibaca dari satu file teks.
- AI tidak otomatis menjamin setiap kode Minecraft benar; verifikasi dengan dokumentasi resmi dan uji dalam dunia salinan.
- Service worker hanya menyimpan kerangka aplikasi. Chat AI tetap memerlukan koneksi internet.
