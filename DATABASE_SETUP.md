# Database Setup Instructions

Database telah dikonfigurasi untuk menggunakan Supabase. Ikuti langkah-langkah berikut:

## Setup Database

### Opsi 1: Manual Setup (Recommended)

1. Buka Supabase Dashboard di https://supabase.com
2. Pilih project Anda
3. Klik "SQL Editor" di sidebar kiri
4. Copy dan paste SQL berikut:

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

5. Klik "Run" untuk mengeksekusi SQL

### Opsi 2: Automatic Setup (Jika tersedia)

```bash
npm install
node setup-db.js
```

## Konfigurasi

Pastikan file `.env` sudah berisi kredensial Supabase:

```
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-anon-key
JWT_SECRET=your-jwt-secret
```

## Verifikasi

Setelah setup, verifikasi bahwa tabel sudah dibuat dengan benar:

1. Di Supabase Dashboard, buka "Table Editor"
2. Pastikan terdapat 2 tabel:
   - `users`
   - `verification_codes`

## Menjalankan Aplikasi

```bash
npm start
```

Aplikasi akan berjalan di http://localhost:3000 dan otomatis redirect ke halaman signin.
