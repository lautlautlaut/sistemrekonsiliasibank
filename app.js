import { api, supabase } from '../backend/supabase/app.js';
import {
  jalankanAutoMatch,
  pasangkanManual,
  buatJurnalPenyesuaian,
  batalkanMatch,
  laporanRekonsiliasi
} from '../backend/logic/matching.js';

/* ============ util ============ */
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');

const PAGE = location.pathname.split('/').pop() || 'index.html';

/* ============ state ============ */
const state = {
  id_account: null,
  id_user: null,
  selected_internal: null,
  selected_bank: null,
  pendingUndo: null
};

/* =================================================
   LOAD MASTER
   ================================================= */
async function initMaster() {
  const accounts = await api.getAccounts();
  const selAcc = $('#sel-account');
  if (selAcc) {
    selAcc.innerHTML = accounts
      .map(a => `<option value="${a.id_account}">${a.nama_bank} - ${a.nomor_rekening}</option>`)
      .join('');
    state.id_account = accounts[0]?.id_account ?? null;
    selAcc.onchange = () => {
      state.id_account = Number(selAcc.value);
      onAccountChange();
    };
  }

  const selUser = $('#sel-user');
  if (selUser) {
    const users = await api.getUsers();
    selUser.innerHTML = users
      .map(u => `<option value="${u.id_user}">${u.nama_user} (${u.role})</option>`)
      .join('');
    state.id_user = users[0]?.id_user ?? null;
    selUser.onchange = () => state.id_user = Number(selUser.value);
  }
}

function onAccountChange() {
  if (PAGE === 'index.html' || PAGE === '') return renderDashboard();
  if (PAGE === 'workspace.html') return renderWorkspace();
  if (PAGE === 'laporan.html') return renderLaporan();
}

/* =================================================
   DASHBOARD
   ================================================= */
async function renderDashboard() {
  const rep = await laporanRekonsiliasi(state.id_account);
  $('#saldo-buku').textContent = rp(rep.saldo_buku);
  $('#saldo-bank').textContent = rp(rep.saldo_bank);
  $('#selisih').textContent    = rp(rep.selisih);
  $('#count-outstanding').textContent = rep.outstanding.length;
  $('#count-belum').textContent       = rep.belumDibukukan.length;
}

/* =================================================
   WORKSPACE
   ================================================= */
async function renderWorkspace() {
  state.selected_internal = null;
  state.selected_bank = null;

  const [internal, bank] = await Promise.all([
    api.getInternal(state.id_account),
    api.getBank(state.id_account)
  ]);

  const tbodyIn = $('#tbl-internal tbody');
  if (tbodyIn) {
    tbodyIn.innerHTML = internal.map(r => `
      <tr class="${r.status_rekonsiliasi === 'Matched' ? 'matched' : ''}">
        <td><input type="checkbox" data-side="in" data-id="${r.id_internal}"
                   ${r.status_rekonsiliasi === 'Matched' ? 'disabled' : ''}></td>
        <td>${r.tanggal}</td>
        <td>${r.no_referensi}</td>
        <td>${r.keterangan}</td>
        <td>${r.jenis_transaksi}</td>
        <td>${rp(r.nominal)}</td>
      </tr>
    `).join('') || '<tr><td colspan="6" style="text-align:center;color:#94a3b8">Tidak ada data</td></tr>';
  }

  const tbodyBank = $('#tbl-bank tbody');
  if (tbodyBank) {
    tbodyBank.innerHTML = bank.map(r => `
      <tr class="${r.status_rekonsiliasi === 'Matched' ? 'matched' : ''}">
        <td><input type="checkbox" data-side="bank" data-id="${r.id_bank}"
                   ${r.status_rekonsiliasi === 'Matched' ? 'disabled' : ''}></td>
        <td>${r.tanggal_bank}</td>
        <td>${r.keterangan_bank}</td>
        <td>${r.jenis_mutasi}</td>
        <td>${rp(r.nominal_bank)}</td>
      </tr>
    `).join('') || '<tr><td colspan="5" style="text-align:center;color:#94a3b8">Tidak ada data</td></tr>';
  }

  $$('input[type=checkbox][data-side]').forEach(cb => {
    cb.onchange = () => {
      const side = cb.dataset.side;
      const id = Number(cb.dataset.id);

      $$(`input[data-side="${side}"]`).forEach(o => {
        if (o !== cb) o.checked = false;
      });

      if (side === 'in')   state.selected_internal = cb.checked ? id : null;
      if (side === 'bank') state.selected_bank     = cb.checked ? id : null;
    };
  });

  await renderHistory();
}

/* =================================================
   RIWAYAT REKONSILIASI
   ================================================= */
async function renderHistory() {
  const tbody = $('#tbl-history tbody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#94a3b8">Memuat riwayat...</td></tr>`;

  try {
    const { data: rekonList, error: err1 } = await supabase
      .from('hasil_rekonsiliasi')
      .select('*')
      .order('tanggal_rekon', { ascending: false });

    if (err1) throw err1;

    console.log('🔍 rekonList:', rekonList);

    if (!rekonList || rekonList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#94a3b8">
        Belum ada rekonsiliasi. Klik ⚡ Jalankan Auto-Match dulu.
      </td></tr>`;
      return;
    }

    const internalIds = [...new Set(rekonList.map(r => r.id_internal).filter(Boolean))];
    const bankIds     = [...new Set(rekonList.map(r => r.id_bank).filter(Boolean))];

    const internalMap = {};
    const bankMap = {};

    if (internalIds.length > 0) {
      const { data: rows, error } = await supabase
        .from('buku_besar_kas').select('*').in('id_internal', internalIds);
      if (error) throw error;
      rows.forEach(r => internalMap[r.id_internal] = r);
    }

    if (bankIds.length > 0) {
      const { data: rows, error } = await supabase
        .from('rekening_koran_bank').select('*').in('id_bank', bankIds);
      if (error) throw error;
      rows.forEach(r => bankMap[r.id_bank] = r);
    }

    tbody.innerHTML = rekonList.map(r => {
      const intData  = r.id_internal ? internalMap[r.id_internal] : null;
      const bankData = r.id_bank     ? bankMap[r.id_bank]         : null;

      const intDesc = intData
        ? `${intData.tanggal} - ${intData.keterangan}<br><small style="color:#64748b">${rp(intData.nominal)}</small>`
        : '<em style="color:#94a3b8">— (hanya di bank)</em>';

      const bankDesc = bankData
        ? `${bankData.tanggal_bank} - ${bankData.keterangan_bank}<br><small style="color:#64748b">${rp(bankData.nominal_bank)}</small>`
        : '<em style="color:#94a3b8">— (hanya di internal)</em>';

      const metodeBadge = r.metode_rekon === 'Auto'
        ? '<span class="badge-metode auto">Auto</span>'
        : '<span class="badge-metode manual">Manual</span>';

      return `
        <tr>
          <td>#${r.id_rekon}</td>
          <td>${new Date(r.tanggal_rekon).toLocaleString('id-ID')}</td>
          <td>${metodeBadge}</td>
          <td>${intDesc}</td>
          <td>${bankDesc}</td>
          <td><button class="btn-undo danger" data-undo="${r.id_rekon}">↩ Batalkan</button></td>
        </tr>
      `;
    }).join('');

    bindUndoButtons();

  } catch (err) {
    console.error('❌ renderHistory error:', err);
    tbody.innerHTML = `<tr><td colspan="6" style="color:#dc2626;padding:12px">Error: ${err.message}</td></tr>`;
  }
}

/* =================================================
   BIND UNDO BUTTONS
   ================================================= */
function bindUndoButtons() {
  $$('[data-undo]').forEach(btn => {
    btn.onclick = () => {
      state.pendingUndo = Number(btn.dataset.undo);
      const alasan = $('#u-alasan');
      if (alasan) alasan.value = '';
      $('#modal-undo').classList.remove('hidden');
    };
  });
}

/* =================================================
   HANDLER WORKSPACE
   ================================================= */
if (PAGE === 'workspace.html') {

  $('#btn-auto').onclick = async () => {
    if (!state.id_account || !state.id_user) return alert('Lengkapi akun & user');
    $('#status-match').textContent = '⏳ Memproses...';
    try {
      const res = await jalankanAutoMatch({
        id_account: state.id_account,
        id_user: state.id_user
      });
      $('#status-match').textContent =
        `✅ ${res.matched} dari ${res.total_internal} internal berhasil di-match.`;
      await renderWorkspace();
    } catch (e) {
      $('#status-match').textContent = '❌ ' + e.message;
    }
  };

  $('#btn-refresh').onclick = () => renderWorkspace();

  const btnHistory = $('#btn-refresh-history');
  if (btnHistory) btnHistory.onclick = () => renderHistory();

  $('#btn-manual').onclick = async () => {
    if (!state.selected_internal || !state.selected_bank) {
      return alert('Pilih 1 baris internal & 1 baris bank dulu');
    }
    try {
      await pasangkanManual({
        id_internal: state.selected_internal,
        id_bank: state.selected_bank,
        id_user: state.id_user
      });
      alert('✅ Manual match berhasil');
      await renderWorkspace();
    } catch (e) { alert('❌ ' + e.message); }
  };

  const modalJurnal = $('#modal-jurnal');
  $('#btn-jurnal').onclick = () => {
    if (!state.selected_internal && !state.selected_bank) {
      return alert('Pilih minimal 1 baris (internal atau bank) untuk dibuat jurnal');
    }
    modalJurnal.classList.remove('hidden');
  };
  $('#j-cancel').onclick = () => modalJurnal.classList.add('hidden');

  $('#j-save').onclick = async () => {
    try {
      await buatJurnalPenyesuaian({
        id_internal: state.selected_internal,
        id_bank: state.selected_bank,
        id_user: state.id_user,
        kode_akun: $('#j-kode').value,
        nama_akun: $('#j-nama').value,
        nominal: Number($('#j-nom').value),
        posisi: $('#j-posisi').value
      });
      modalJurnal.classList.add('hidden');
      alert('✅ Jurnal penyesuaian dibuat');
      await renderWorkspace();
    } catch (e) { alert('❌ ' + e.message); }
  };

  const modalUndo = $('#modal-undo');

  $('#u-cancel').onclick = () => {
    modalUndo.classList.add('hidden');
    state.pendingUndo = null;
  };

  $('#u-confirm').onclick = async () => {
    const id_rekon = state.pendingUndo;
    if (!id_rekon) return;

    const alasan = $('#u-alasan').value.trim() || null;

    const btn = $('#u-confirm');
    btn.disabled = true;
    btn.textContent = '⏳ Memproses...';

    try {
      const res = await batalkanMatch({ id_rekon, alasan });
      modalUndo.classList.add('hidden');
      alert('✅ ' + res.message);
      await renderWorkspace();
    } catch (e) {
      alert('❌ ' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Ya, Batalkan';
      state.pendingUndo = null;
    }
  };
}

/* =================================================
   LAPORAN
   ================================================= */
async function renderLaporan() {
  const rep = await laporanRekonsiliasi(state.id_account);

  $('#r-buku').textContent    = rp(rep.saldo_buku);
  $('#r-bank').textContent    = rp(rep.saldo_bank);
  $('#r-selisih').textContent = rp(rep.selisih);
  $('#periode').textContent   = 'Per ' + new Date().toLocaleDateString('id-ID');

  $('#tbl-out tbody').innerHTML = rep.outstanding.map(r => `
    <tr>
      <td>${r.tanggal}</td><td>${r.no_referensi}</td>
      <td>${r.keterangan}</td><td>${rp(r.nominal)}</td>
    </tr>
  `).join('') || '<tr><td colspan="4">— tidak ada —</td></tr>';

  $('#tbl-belum tbody').innerHTML = rep.belumDibukukan.map(r => `
    <tr>
      <td>${r.tanggal_bank}</td><td>${r.keterangan_bank}</td>
      <td>${r.jenis_mutasi}</td><td>${rp(r.nominal_bank)}</td>
    </tr>
  `).join('') || '<tr><td colspan="4">— tidak ada —</td></tr>';
}

if (PAGE === 'laporan.html') {
  $('#btn-print').onclick = () => window.print();
}

/* =================================================
   BOOTSTRAP
   ================================================= */
(async function init() {
  try {
    await initMaster();
    if (PAGE === 'index.html' || PAGE === '') await renderDashboard();
    if (PAGE === 'workspace.html')            await renderWorkspace();
    if (PAGE === 'laporan.html')              await renderLaporan();
  } catch (err) {
    console.error('❌ Init error:', err);
    alert('❌ ' + err.message);
  }
})();