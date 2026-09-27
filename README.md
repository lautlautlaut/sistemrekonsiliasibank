# 🏦 SIA Rekonsiliasi Bank

Sistem Informasi Akuntansi untuk rekonsiliasi bank otomatis.
Mencocokkan transaksi internal perusahaan dengan mutasi rekening koran bank.

## ✨ Fitur

- 📥 Import mutasi rekening koran dari file CSV bank
- ⚡ Auto-match transaksi internal vs bank (nominal + toleransi tanggal ≤1 hari)
- 🔗 Manual match untuk penyesuaian khusus
- ↩ Undo match (batalkan rekonsiliasi yang salah)
- 📝 Jurnal penyesuaian double-entry otomatis
- 📊 Laporan rekonsiliasi bank (outstanding & belum dibukukan)

## 🛠️ Teknologi

- **Frontend:** HTML, CSS, JavaScript (ES Module)
- **Backend:** Supabase (PostgreSQL)
- **Library:** @supabase/supabase-js

## 📁 Struktur Folder
