export const SUPABASE_SQL_SCHEMA = `-- =====================================================================
-- SISTEM PEMINJAMAN LAPTOP SISWA — SKRIP DATABASE SUPABASE (POSTGRESQL)
-- Mendukung: RBAC Admin + Token Guru Piket, Wilayah Putra & Putri,
-- 3 Sesi Harian (Siang, Sore, Malam) dengan Batas Jam Terlambat,
-- Mode Scan Harian & Bawa Pulang, Kode Siswa Otomatis (SIS-XXXX),
-- dan Suspend Siswa dengan Batas Waktu (suspended_until)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS laptops CASCADE;
DROP TABLE IF EXISTS students CASCADE;
DROP TABLE IF EXISTS schedules CASCADE;
DROP TABLE IF EXISTS daily_sessions CASCADE;
DROP TABLE IF EXISTS staff CASCADE;
DROP SEQUENCE IF EXISTS student_code_seq;

CREATE SEQUENCE student_code_seq START 1;

-- 1. Tabel Staff (Admin & Guru Piket Putra/Putri + Token Guru Piket)
CREATE TABLE staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  piket_token TEXT NOT NULL DEFAULT 'PKT-101',
  role TEXT NOT NULL CHECK (role IN ('admin', 'piket')),
  wilayah TEXT NOT NULL DEFAULT 'semua' CHECK (wilayah IN ('putra', 'putri', 'semua')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Tabel Siswa (Kode Unik Otomatis SIS-0001 + Wilayah + Suspend Sampai Kapan)
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_code TEXT UNIQUE NOT NULL DEFAULT ('SIS-' || lpad(nextval('student_code_seq')::text, 4, '0')),
  name TEXT NOT NULL,
  class TEXT NOT NULL,
  wilayah TEXT NOT NULL DEFAULT 'putra' CHECK (wilayah IN ('putra', 'putri')),
  photo_url TEXT,
  late_count INT NOT NULL DEFAULT 0,
  is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
  suspended_until TIMESTAMPTZ,
  suspended_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Tabel Laptop (Relasi 1-ke-1 dengan Pemilik Siswa)
CREATE TABLE laptops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_code TEXT UNIQUE NOT NULL,
  brand_model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'borrowed')),
  assigned_student_id UUID UNIQUE REFERENCES students(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Tabel 3 Sesi Harian Laptop (Siang, Sore, Malam) & Batas Jam Terlambat
CREATE TABLE daily_sessions (
  key TEXT PRIMARY KEY CHECK (key IN ('siang', 'sore', 'malam')),
  label TEXT NOT NULL,
  start_time TIME NOT NULL,
  deadline_time TIME NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO daily_sessions (key, label, start_time, deadline_time, is_active) VALUES
  ('siang', 'Sesi Siang', '12:30:00', '14:30:00', TRUE),
  ('sore', 'Sesi Sore', '15:30:00', '17:30:00', TRUE),
  ('malam', 'Sesi Malam', '19:30:00', '21:30:00', TRUE);

-- 5. Tabel Transaksi (Harian Sesi Siang/Sore/Malam & Bawa Pulang + Audit Piket)
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  laptop_id UUID NOT NULL REFERENCES laptops(id) ON DELETE CASCADE,
  wilayah TEXT NOT NULL CHECK (wilayah IN ('putra', 'putri')),
  transaction_type TEXT NOT NULL DEFAULT 'harian' CHECK (transaction_type IN ('harian', 'pulang')),
  daily_session TEXT CHECK (daily_session IN ('siang', 'sore', 'malam')),
  home_note TEXT,
  piket_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  piket_name TEXT NOT NULL,
  return_piket_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  return_piket_name TEXT,
  purpose TEXT NOT NULL DEFAULT 'Sesi Sore',
  borrow_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_time TIMESTAMPTZ NOT NULL,
  return_time TIMESTAMPTZ,
  is_late BOOLEAN NOT NULL DEFAULT FALSE,
  late_minutes INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'returned'))
);

-- Trigger otomatis: suspend akun siswa 7 hari saat mencapai 3 kali terlambat
CREATE OR REPLACE FUNCTION handle_late_return_sanction()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'returned' AND OLD.status = 'active' AND NEW.is_late = TRUE THEN
    UPDATE students
    SET
      late_count = late_count + 1,
      is_suspended = CASE WHEN late_count + 1 >= 3 THEN TRUE ELSE is_suspended END,
      suspended_until = CASE
        WHEN late_count + 1 >= 3 THEN NOW() + INTERVAL '7 days'
        ELSE suspended_until
      END,
      suspended_reason = CASE
        WHEN late_count + 1 >= 3 THEN 'Terlambat mengembalikan laptop sebanyak 3 kali (Sanksi Otomatis)'
        ELSE suspended_reason
      END
    WHERE id = NEW.student_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_late_return_sanction
AFTER UPDATE ON transactions
FOR EACH ROW
EXECUTE FUNCTION handle_late_return_sanction();
`;
