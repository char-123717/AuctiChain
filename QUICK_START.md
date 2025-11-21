# Quick Start Guide

## Implementasi Selesai

Database Supabase telah diintegrasikan dengan aplikasi. Data user kini tersimpan secara permanen dan tidak hilang saat server restart.

## Setup dalam 3 Langkah

### Langkah 1: Setup Database

Buka Supabase Dashboard dan jalankan SQL ini di SQL Editor:

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

### Langkah 2: Install Dependencies

```bash
npm install
```

### Langkah 3: Jalankan Aplikasi

```bash
npm start
```

Buka browser: http://localhost:3000

## Verifikasi

Aplikasi berjalan dengan benar jika:

1. Buka http://localhost:3000 → Otomatis redirect ke /signin.html
2. Klik "Sign up" → Form signup muncul
3. Isi form dan submit → User tersimpan di database Supabase
4. Setelah verify email → Bisa login
5. Setelah login → Masuk ke lobby (index.html)

## Alur Baru

```
http://localhost:3000
    ↓
Cek token?
    ├─ Tidak ada → /signin.html
    └─ Ada valid → /index.html (lobby)
```

## File Penting

- `db.js` - Database service
- `authRoutes.js` - Auth dengan database
- `server.js` - Server dengan routing yang diperbaiki
- `supabase/migrations/` - SQL schema

## Dokumentasi Lengkap

- `SETUP_GUIDE.md` - Setup lengkap
- `DATABASE_SETUP.md` - Setup database detail
- `IMPLEMENTATION_SUMMARY.md` - Ringkasan implementasi

## Troubleshooting

**Server tidak bisa start?**
- Cek apakah .env file ada dan benar
- Pastikan Supabase credentials valid

**Tidak bisa login?**
- Pastikan email sudah diverifikasi
- Cek data user di Supabase Table Editor

**Redirect loop?**
- Clear browser localStorage
- Restart server

## Support

Baca dokumentasi lengkap di:
- SETUP_GUIDE.md
- IMPLEMENTATION_SUMMARY.md
