import { supabase, api } from '../supabase/app.js';

/* =========================================================
   AUTO-MATCH
   ========================================================= */
export async function jalankanAutoMatch({ id_account, id_user }) {
  const internal = await api.getInternal(id_account, 'Unmatched');
  const bank     = await api.getBank(id_account, 'Unmatched');

  const bankPool = [...bank];
  let matched = 0;

  for (const trx of internal) {
    const idx = bankPool.findIndex(b => {
      const d1 = new Date(trx.tanggal);
      const d2 = new Date(b.tanggal_bank);
      const diffDays = Math.abs((d1 - d2) / 86400000);

      const jenisCocok =
        (trx.jenis_transaksi === 'Masuk'  && b.jenis_mutasi === 'CR') ||
        (trx.jenis_transaksi === 'Keluar' && b.jenis_mutasi === 'DB');

      return Number(b.nominal_bank) === Number(trx.nominal) &&
             diffDays <= 1 &&
             jenisCocok;
    });

    if (idx === -1) continue;

    const bankMatch = bankPool[idx];
    bankPool.splice(idx, 1);

    await api.insertRekon({
      id_internal: trx.id_internal,
      id_bank:     bankMatch.id_bank,
      id_user,
      metode_rekon: 'Auto',
      keterangan_selisih: null
    });

    await supabase.from('buku_besar_kas')
      .update({ status_rekonsiliasi: 'Matched' }).eq('id_internal', trx.id_internal);

    await supabase.from('rekening_koran_bank')
      .update({ status_rekonsiliasi: 'Matched' }).eq('id_bank', bankMatch.id_bank);

    matched++;
  }

  return { success: true, matched, total_internal: internal.length, total_bank: bank.length };
}

/* =========================================================
   MANUAL MATCH
   ========================================================= */
export async function pasangkanManual({ id_internal, id_bank, id_user }) {
  await api.insertRekon({
    id_internal, id_bank, id_user, metode_rekon: 'Manual'
  });
  await supabase.from('buku_besar_kas')
    .update({ status_rekonsiliasi: 'Matched' }).eq('id_internal', id_internal);
  await supabase.from('rekening_koran_bank')
    .update({ status_rekonsiliasi: 'Matched' }).eq('id_bank', id_bank);

  return { success: true };
}

/* =========================================================
   JURNAL PENYESUAIAN (Double-Entry)
   ========================================================= */
export async function buatJurnalPenyesuaian({
  id_internal, id_bank, id_user,
  kode_akun, nama_akun, nominal, posisi,
  lawan_kode, lawan_nama
}) {
  lawan_kode = lawan_kode || '1101';
  lawan_nama = lawan_nama || 'Kas di Bank';

  const rekon = await api.insertRekon({
    id_internal: id_internal || null,
    id_bank:     id_bank || null,
    id_user,
    metode_rekon: 'Manual',
    keterangan_selisih: `${nama_akun} - ${nominal}`
  });

  const lawanPosisi = posisi === 'Debit' ? 'Kredit' : 'Debit';
  await api.insertJurnalBulk([
    { id_rekon: rekon.id_rekon, tanggal_jurnal: new Date().toISOString().slice(0,10),
      kode_akun, nama_akun, posisi, nominal },
    { id_rekon: rekon.id_rekon, tanggal_jurnal: new Date().toISOString().slice(0,10),
      kode_akun: lawan_kode, nama_akun: lawan_nama, posisi: lawanPosisi, nominal }
  ]);

  return { success: true, id_rekon: rekon.id_rekon };
}

/* =========================================================
   BATALKAN MATCH (UNDO)
   ========================================================= */
export async function batalkanMatch({ id_rekon, alasan }) {
  if (!id_rekon) throw new Error('id_rekon wajib diisi');

  // 1. Ambil data rekonsiliasi
  const { data: rekon, error: e1 } = await supabase
    .from('hasil_rekonsiliasi')
    .select('*')
    .eq('id_rekon', id_rekon)
    .maybeSingle();

  if (e1) throw e1;
  if (!rekon) throw new Error('Data rekonsiliasi tidak ditemukan');

  // 2. Hapus jurnal penyesuaian terkait
  const { error: e2 } = await supabase
    .from('jurnal_penyesuaian')
    .delete()
    .eq('id_rekon', id_rekon);
  if (e2) throw e2;

  // 3. Hapus baris hasil_rekonsiliasi
  const { error: e3 } = await supabase
    .from('hasil_rekonsiliasi')
    .delete()
    .eq('id_rekon', id_rekon);
  if (e3) throw e3;

  // 4. Kembalikan status internal → Unmatched
  if (rekon.id_internal) {
    const { error: e4 } = await supabase
      .from('buku_besar_kas')
      .update({ status_rekonsiliasi: 'Unmatched' })
      .eq('id_internal', rekon.id_internal);
    if (e4) throw e4;
  }

  // 5. Kembalikan status bank → Unmatched
  if (rekon.id_bank) {
    const { error: e5 } = await supabase
      .from('rekening_koran_bank')
      .update({ status_rekonsiliasi: 'Unmatched' })
      .eq('id_bank', rekon.id_bank);
    if (e5) throw e5;
  }

  return {
    success: true,
    message: 'Rekonsiliasi berhasil dibatalkan',
    id_rekon,
    id_internal: rekon.id_internal,
    id_bank: rekon.id_bank,
    alasan: alasan || null
  };
}

/* =========================================================
   LAPORAN REKONSILIASI BANK
   ========================================================= */
export async function laporanRekonsiliasi(id_account) {
  const semuaInternal = await api.getInternal(id_account);
  const semuaBank     = await api.getBank(id_account);

  const saldoBuku = semuaInternal.reduce((s, r) =>
    s + (r.jenis_transaksi === 'Masuk' ? Number(r.nominal) : -Number(r.nominal)), 0);

  const saldoBank = semuaBank.reduce((s, r) =>
    s + (r.jenis_mutasi === 'CR' ? Number(r.nominal_bank) : -Number(r.nominal_bank)), 0);

  const outstanding    = semuaInternal.filter(r => r.status_rekonsiliasi === 'Unmatched');
  const belumDibukukan = semuaBank.filter(r => r.status_rekonsiliasi === 'Unmatched');

  return {
    saldo_buku: saldoBuku,
    saldo_bank: saldoBank,
    selisih: saldoBuku - saldoBank,
    outstanding,
    belumDibukukan
  };
}