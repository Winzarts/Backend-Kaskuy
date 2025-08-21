# Backend KasKuy

Backend untuk aplikasi pembukuan kas (KasKuy) menggunakan **Node.js + Express** dengan **Supabase** sebagai database dan autentikasi.  
Fitur utama backend ini antara lain:  
- Register & Login (email/password & Google OAuth).  
- Autentikasi user (JWT via Supabase).  
- Set Profile & Update Profile.  
- Manajemen transaksi (pemasukan/pengeluaran).  
- Export transaksi ke **Excel (.xls)**.  
- Forgot Password.  
- Verifikasi Email & Ganti Password.  
- Kirim Email Verifikasi via **SMTP**.  

---

## 🚀 Tech Stack
- **Node.js** + **Express.js**
- **Supabase** (Auth & Database)
- **Nodemailer** (untuk email verifikasi / reset password)
- **xlsx** (untuk export transaksi ke file Excel)
- **dotenv** (mengelola environment variables)

---

## ⚙️ Setup Project

1. **Clone repo ini**
   ```bash
   git clone https://github.com/username/kaskuy-backend.git
   cd kaskuy-backend

npm install
