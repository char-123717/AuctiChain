# Setup Guide - Premium Auction Platform

## Yang Telah Diimplementasikan

### 1. Database Integration dengan Supabase
- Data user kini tersimpan secara permanen di database Supabase
- User yang sudah sign-up dan verify email akan tetap tersimpan
- Data tidak akan hilang saat server restart

### 2. Alur Aplikasi yang Diperbaiki
- Ketika membuka localhost:3000, langsung diarahkan ke halaman signin
- Setelah berhasil login, user diarahkan ke halaman index (lobby auction)
- User yang belum verify email tidak bisa login

## Cara Setup

### Step 1: Setup Database Supabase

Buka Supabase Dashboard dan jalankan SQL berikut di SQL Editor:

```sql
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password text NOT NULL,
  name text NOT NULL,
  role text DEFAULT 'bidder' NOT NULL,
  verified boolean DEFAULT false NOT NULL,
  provider text DEFAULT 'local' NOT NULL,
  requires_password_reset boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  email text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_verification_codes_code ON verification_codes(code);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_codes ENABLE ROW LEVEL SECURITY;
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Konfigurasi Environment Variables

Pastikan file `.env` berisi:

```
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-anon-key
JWT_SECRET=your-jwt-secret-key
SEPOLIA_RPC_URL=your-infura-url
SEPOLIA_WS_URL=your-infura-ws-url
CONTRACT_ADDRESS_101=your-contract-address-101
CONTRACT_ADDRESS_102=your-contract-address-102
```

### Step 4: Jalankan Aplikasi

```bash
npm start
```

Aplikasi akan berjalan di http://localhost:3000

## Alur Penggunaan

### 1. Sign Up (Pendaftaran Baru)
- Kunjungi http://localhost:3000 (akan otomatis redirect ke signin)
- Klik "Sign up"
- Isi nama, email, dan password
- User akan menerima email verifikasi
- Klik link verifikasi di email

### 2. Sign In (Login)
- Masukkan email dan password
- Setelah berhasil login, langsung masuk ke lobby (index.html)
- User yang belum verify email tidak bisa login

### 3. Forgot Password
- Klik "Forgot password" di halaman signin
- Masukkan email
- Akan menerima temporary password via email
- Login dengan temporary password
- Akan diarahkan untuk set password baru

## File-file yang Diubah

1. **db.js** (BARU) - Database service layer untuk Supabase
2. **authRoutes.js** - Diupdate untuk menggunakan Supabase
3. **server.js** - Diupdate untuk menggunakan database dan perbaikan routing
4. **package.json** - Ditambahkan dependency @supabase/supabase-js
5. **supabase/migrations/** - Migration SQL files

## Fitur Database

- Data user tersimpan permanen
- Email verification codes dengan expiry otomatis
- Password hashing dengan bcrypt
- JWT token authentication
- Row Level Security (RLS) enabled
- Auto-cleanup expired verification codes

## Troubleshooting

### Jika database belum ter-setup:
1. Pastikan SQL sudah dijalankan di Supabase Dashboard
2. Cek koneksi Supabase dengan kredensial yang benar
3. Periksa console log untuk error messages

### Jika tidak bisa login:
1. Pastikan email sudah diverifikasi
2. Cek apakah user ada di database Supabase
3. Periksa JWT_SECRET di .env file

### Jika redirect loop:
1. Clear localStorage browser
2. Clear cookies
3. Restart server
