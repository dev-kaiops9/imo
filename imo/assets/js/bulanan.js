/**
 * bulanan.js
 * -----------------------------------------------------------------------
 * Logika halaman "IMO - Per Bulan":
 *  1. Dropdown Bulan & Tahun (untuk cover + filter daftar PDF tersimpan).
 *  2. Upload SmartCard & Upload Daftar Hadir (1 foto masing-masing).
 *  3. Daftar PDF Tersimpan bulan/tahun terpilih (sumber: action backend
 *     "cekPdfTersimpan", sama seperti dipakai widget "PDF Tersimpan" di
 *     sidebar kanan dashboard) — diurutkan tanggal termuda dulu, lalu
 *     Dinas Pagi -> Siang -> Malam pada tanggal yang sama.
 *  4. Tombol "Unduh IMO": menggabungkan Cover + SmartCard (landscape) +
 *     Daftar Hadir + seluruh PDF tersimpan di atas menjadi SATU file PDF
 *     (pakai pdf-lib), lalu mengirimkannya ke backend untuk disimpan ke
 *     Google Drive dengan struktur folder yang SAMA seperti menu Per Hari:
 *     {DRIVE_ROOT_FOLDER}/{Stasiun}/{Jabatan}/{NIPP}/
 *
 * CATATAN PENTING (backend):
 * Pengiriman ke backend memakai action baru "simpanImoBulanan" (lihat
 * fungsi Api.simpanImoBulanan di bawah). Action ini BELUM tentu ada di
 * Google Apps Script (Code.gs) — perlu ditambahkan di sana dengan pola
 * yang sama seperti action "simpanData" (dipakai menu Per Hari), supaya
 * PDF benar-benar tersimpan ke Drive.
 * -----------------------------------------------------------------------
 */

const SESSION_STORAGE_KEY = "imoUser";
const BULAN_LIST = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const DINAS_ORDER = { "Pagi": 0, "Siang": 1, "Malam": 2 };

/**
 * Susun nama file rekap bulanan: (BULAN)_STA (STASIUN)_(NAMA)_(JABATAN)_(NIPP).pdf
 * Contoh: AGUSTUS_STA GLENMORE_BUDI SANTOSO_PPKA_69123.pdf
 * Semua bagian teks (bulan/stasiun/nama/jabatan) diseragamkan ke huruf besar.
 */
function buildNamaFileBulanan_(bulanNama, user) {
  const up = (v) => String(v || "").trim().toUpperCase();
  return `${up(bulanNama)}_STA ${up(user.stasiun)}_${up(user.nama)}_${up(user.jabatan)}_${up(user.nipp)}.pdf`;
}

/** Trigger unduhan file PDF (base64) langsung dari browser, terpisah dari
 *  proses simpan ke Google Drive. */
function downloadBase64Pdf_(base64, fileName) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  const blob = new Blob([new Uint8Array(byteNumbers)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------
// Toast & Busy overlay (pola sama dengan menu Per Hari)
// ---------------------------------------------------------------------
const Toast = {
  el: null,
  init() { this.el = document.getElementById("toastStack"); },
  show(message, kind = "info") {
    if (!this.el) this.init();
    const item = document.createElement("div");
    const tone = {
      info: "bg-slate-800",
      warn: "bg-amber-600",
      error: "bg-rose-600",
      success: "bg-emerald-600",
    }[kind] || "bg-slate-800";
    item.className = `${tone} text-white text-xs font-medium px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2 transition-all duration-300`;
    item.style.marginTop = "8px";
    item.innerHTML = `<i class="fa-solid fa-circle-info"></i><span>${message}</span>`;
    this.el.appendChild(item);
    setTimeout(() => {
      item.style.opacity = "0";
      item.style.transform = "translateY(6px)";
      setTimeout(() => item.remove(), 300);
    }, 3500);
  },
};

const Busy = {
  show(text) {
    document.getElementById("busyText").textContent = text || "MEMPROSES…";
    document.getElementById("busyOverlay").classList.add("is-open");
  },
  hide() { document.getElementById("busyOverlay").classList.remove("is-open"); },
};

// ---------------------------------------------------------------------
// Sesi Login (dibaca dari localStorage "imoUser" milik dashboard IMO
// Tools — halaman ini dimuat sebagai iframe pada origin yang sama).
// ---------------------------------------------------------------------
const Session = {
  current: null,

  load() {
    this.current = this._read();

    const banner = document.getElementById("identityBanner");
    const notLoggedIn = document.getElementById("notLoggedInPanel");
    const mainFormArea = document.getElementById("mainFormArea");

    if (this.current) {
      document.getElementById("idNama").textContent = this.current.nama || "-";
      document.getElementById("idNipp").textContent = this.current.nipp || "-";
      document.getElementById("idJabatan").textContent = this.current.jabatan || "-";
      document.getElementById("idStasiun").textContent = this.current.stasiun || "-";
      banner.classList.remove("hidden");
      notLoggedIn.classList.add("hidden");
      mainFormArea.classList.remove("hidden");
      return true;
    }

    banner.classList.add("hidden");
    mainFormArea.classList.add("hidden");
    notLoggedIn.classList.remove("hidden");
    return false;
  },

  _read() {
    try {
      const raw = window.parent && window.parent !== window
        ? window.parent.localStorage.getItem(SESSION_STORAGE_KEY)
        : localStorage.getItem(SESSION_STORAGE_KEY);
      const user = JSON.parse(raw);
      if (user && user.nama && user.nipp) return user;
    } catch (err) { /* sesi rusak -> anggap belum login */ }
    return null;
  },
};

// ---------------------------------------------------------------------
// Upload foto tunggal (SmartCard / Daftar Hadir) — pola sama dengan
// UploadField di menu Per Hari, tapi masing-masing cuma 1 foto.
// ---------------------------------------------------------------------
const UploadSingle = {
  state: { smartcard: null, daftarHadir: null },

  init() {
    this._wire("dzSmartcard", "fileSmartcard", "thumbSmartcard", "smartcard");
    this._wire("dzDaftarHadir", "fileDaftarHadir", "thumbDaftarHadir", "daftarHadir");
  },

  _wire(dzId, inputId, thumbId, stateKey) {
    const dz = document.getElementById(dzId);
    const input = document.getElementById(inputId);
    const thumbWrap = document.getElementById(thumbId);
    if (!dz || !input || !thumbWrap) return;

    const openPicker = () => input.click();
    dz.addEventListener("click", openPicker);
    dz.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(); }
    });

    input.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) this._handleFile(file, stateKey, thumbWrap, dz);
    });

    ["dragenter", "dragover"].forEach((evt) => {
      dz.addEventListener(evt, (e) => { e.preventDefault(); dz.classList.add("is-dragover"); });
    });
    ["dragleave", "drop"].forEach((evt) => {
      dz.addEventListener(evt, (e) => { e.preventDefault(); dz.classList.remove("is-dragover"); });
    });
    dz.addEventListener("drop", (e) => {
      const file = e.dataTransfer.files[0];
      if (file) this._handleFile(file, stateKey, thumbWrap, dz);
    });
  },

  async _handleFile(file, stateKey, thumbWrap, dz) {
    if (!file.type.startsWith("image/")) { Toast.show("File yang dipilih bukan gambar.", "error"); return; }
    if (file.size > 8 * 1024 * 1024) { Toast.show("Ukuran foto maksimal 8MB.", "error"); return; }

    const dataUrl = await this._readAsDataURL(file);
    this.state[stateKey] = { file, dataUrl, mimeType: file.type, fileName: file.name };

    dz.classList.remove("is-invalid");
    const errId = stateKey === "smartcard" ? "err-smartcard" : "err-daftarHadir";
    const errEl = document.getElementById(errId);
    if (errEl) errEl.closest(".field").classList.remove("has-error");

    thumbWrap.innerHTML = `
      <div class="thumb">
        <img src="${dataUrl}" alt="${file.name}" />
        <button type="button" class="thumb__remove" aria-label="Hapus foto">✕</button>
      </div>`;
    thumbWrap.querySelector(".thumb__remove").addEventListener("click", (e) => {
      e.stopPropagation();
      this.state[stateKey] = null;
      thumbWrap.innerHTML = "";
    });
  },

  _readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },
};

// ---------------------------------------------------------------------
// Dropdown Bulan & Tahun
// ---------------------------------------------------------------------
const MonthYear = {
  init(onChange) {
    const selBulan = document.getElementById("selBulan");
    const selTahun = document.getElementById("selTahun");
    const now = new Date();

    BULAN_LIST.forEach((nama, idx) => {
      const o = document.createElement("option");
      o.value = String(idx + 1).padStart(2, "0");
      o.textContent = nama;
      selBulan.appendChild(o);
    });
    selBulan.value = String(now.getMonth() + 1).padStart(2, "0");

    const currentYear = now.getFullYear();
    for (let y = currentYear - 2; y <= currentYear + 1; y++) {
      const o = document.createElement("option");
      o.value = String(y);
      o.textContent = String(y);
      selTahun.appendChild(o);
    }
    selTahun.value = String(currentYear);

    selBulan.addEventListener("change", onChange);
    selTahun.addEventListener("change", onChange);
  },

  get() {
    const bulanIdx = Number(document.getElementById("selBulan").value); // 1-12
    const tahun = document.getElementById("selTahun").value;
    return { bulanIdx, bulanNama: BULAN_LIST[bulanIdx - 1], tahun };
  },
};

// ---------------------------------------------------------------------
// Komunikasi ke backend Google Apps Script
// ---------------------------------------------------------------------
const Api = {
  async _post(payload) {
    const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Server merespons status ${res.status}`);
    const json = await res.json();
    if (json.ok === false) throw new Error(json.message || "Terjadi kesalahan pada server.");
    return json;
  },

  /** Sama seperti dipakai widget "PDF Tersimpan" di sidebar dashboard. */
  async cekPdfTersimpan(nipp) {
    const json = await this._post({ action: "cekPdfTersimpan", nipp });
    return (json.data && json.data.list) || [];
  },

  /**
   * Kirim PDF gabungan (Cover + SmartCard + Daftar Hadir + PDF harian) ke
   * backend untuk disimpan ke Drive — folder SAMA persis dengan menu Per
   * Hari ({DRIVE_ROOT_FOLDER}/{Stasiun}/{Jabatan}/{NIPP}/).
   *
   * PERLU DITAMBAHKAN di Code.gs: action "simpanImoBulanan" (lihat
   * catatan di kepala file ini).
   */
  async simpanImoBulanan({ user, bulanNama, tahun, pdfFileName, pdfBase64 }) {
    const json = await this._post({
      action: "simpanImoBulanan",
      payload: {
        nipp: user.nipp,
        nama: user.nama,
        jabatan: user.jabatan,
        stasiun: user.stasiun,
        bulan: bulanNama,
        tahun: tahun,
        driveRootFolder: CONFIG.DRIVE_ROOT_FOLDER,
        pdfFileName,
        pdfBase64,
      },
    });
    return json.data || {};
  },
};

// ---------------------------------------------------------------------
// Daftar "PDF Tersimpan" — diambil sekali per load, difilter ulang tiap
// kali dropdown Bulan/Tahun berubah (tidak perlu fetch ulang ke server).
// ---------------------------------------------------------------------
const SavedPdfList = {
  all: [],

  async loadForUser(nipp) {
    document.getElementById("bulanPdfListWrap").innerHTML =
      `<div class="text-center py-6 text-xs text-slate-400">Memuat…</div>`;
    try {
      this.all = await Api.cekPdfTersimpan(nipp);
    } catch (err) {
      this.all = [];
      document.getElementById("bulanPdfListWrap").innerHTML =
        `<div class="text-center py-6 text-xs text-rose-400">Gagal memuat daftar PDF: ${err.message}</div>`;
      Toast.show("Gagal memuat daftar PDF tersimpan.", "error");
    }
  },

  _parseTanggal(str) {
    const parts = String(str || "").split("-").map(Number);
    const dd = parts[0] || 1, mm = parts[1] || 1, yyyy = parts[2] || 1970;
    return { dd, mm, yyyy, ts: new Date(yyyy, mm - 1, dd).getTime() };
  },

  /** Filter sesuai bulan/tahun terpilih, lalu urutkan tanggal muda dulu -> Pagi/Siang/Malam. */
  filteredSorted(bulanIdx, tahun) {
    const filtered = this.all.filter((item) => {
      const t = this._parseTanggal(item.tanggal);
      return t.mm === bulanIdx && String(t.yyyy) === String(tahun);
    });
    return filtered.sort((a, b) => {
      const ta = this._parseTanggal(a.tanggal).ts;
      const tb = this._parseTanggal(b.tanggal).ts;
      if (ta !== tb) return ta - tb;
      const da = DINAS_ORDER.hasOwnProperty(a.dinas) ? DINAS_ORDER[a.dinas] : 99;
      const db = DINAS_ORDER.hasOwnProperty(b.dinas) ? DINAS_ORDER[b.dinas] : 99;
      return da - db;
    });
  },

  render(bulanIdx, tahun) {
    const list = this.filteredSorted(bulanIdx, tahun);
    const wrap = document.getElementById("bulanPdfListWrap");
    document.getElementById("bulanPdfCount").textContent = String(list.length);

    if (!list.length) {
      wrap.innerHTML = `<div class="text-center py-6 text-xs text-slate-400">Belum ada PDF tersimpan pada bulan &amp; tahun ini.</div>`;
      return list;
    }

    wrap.innerHTML = list.map((item) => `
      <div class="flex items-center justify-between gap-2 bg-white rounded-2xl border border-slate-100 px-3 py-2.5 shadow-sm">
        <div class="min-w-0">
          <p class="text-[11px] font-bold text-slate-700 font-mono truncate">${item.tanggal}</p>
          <div class="flex items-center gap-1.5 mt-0.5">
            <span class="text-[9px] bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded-full shrink-0">${item.dinas}</span>
            <span class="text-[10px] text-slate-500 truncate">${item.jenisSerahTerima}</span>
          </div>
        </div>
        ${item.fileUrl
          ? `<a href="${item.fileUrl}" target="_blank" rel="noopener noreferrer" class="shrink-0 text-[10px] font-semibold text-white bg-[#5B58CA] hover:bg-[#4a47b5] px-3 py-1.5 rounded-full transition">Lihat PDF</a>`
          : `<span class="shrink-0 text-[10px] text-slate-300">Tidak ada</span>`}
      </div>
    `).join("");

    return list;
  },
};

// ---------------------------------------------------------------------
// Membangun PDF akhir dengan pdf-lib:
//   Hal 1: Cover (placeholder — desain final menyusul)
//   Hal 2: Foto SmartCard (landscape)
//   Hal 3: Foto Daftar Hadir
//   Hal 4-selesai: gabungan PDF harian (urutan sudah difilter+diurutkan)
// ---------------------------------------------------------------------
const PdfBulanan = {
  async build({ user, bulanNama, tahun, smartcard, daftarHadir, savedList }) {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const out = await PDFDocument.create();
    const fontBold = await out.embedFont(StandardFonts.HelveticaBold);
    const fontRegular = await out.embedFont(StandardFonts.Helvetica);

    // ---- Halaman 1: Cover (portrait A4) ----
    // Desain final cover akan menyusul — untuk sekarang berisi info inti saja.
    const A4_PORTRAIT = [595.28, 841.89];
    const A4_LANDSCAPE = [841.89, 595.28];

    const cover = out.addPage(A4_PORTRAIT);
    const { width: cw, height: ch } = cover.getSize();
    const centerText = (text, y, size, font, color) => {
      const w = font.widthOfTextAtSize(text, size);
      cover.drawText(text, { x: (cw - w) / 2, y, size, font, color: color || rgb(0.1, 0.1, 0.15) });
    };
    centerText("IKHTISAR MINGGUAN OPERASI (IMO)", ch - 160, 20, fontBold);
    centerText(`${bulanNama.toUpperCase()} ${tahun}`, ch - 190, 15, fontRegular);

    const idLines = [
      `Nama    : ${user.nama || "-"}`,
      `NIPP    : ${user.nipp || "-"}`,
      `Jabatan : ${user.jabatan || "-"}`,
      `Stasiun : ${user.stasiun || "-"}`,
    ];
    idLines.forEach((line, i) => {
      cover.drawText(line, { x: cw / 2 - 100, y: ch / 2 - i * 20, size: 12, font: fontRegular, color: rgb(0.2, 0.2, 0.25) });
    });

    // ---- Halaman 2: Foto SmartCard (landscape) ----
    if (smartcard) {
      const page = out.addPage(A4_LANDSCAPE);
      await this._drawImageFitted(out, page, smartcard);
    }

    // ---- Halaman 3: Foto Daftar Hadir ----
    if (daftarHadir) {
      const page = out.addPage(A4_PORTRAIT);
      await this._drawImageFitted(out, page, daftarHadir);
    }

    // ---- Halaman 4-selesai: gabungan PDF harian tersimpan ----
    for (const item of savedList) {
      if (!item.fileUrl) continue;
      try {
        const bytes = await this._fetchArrayBuffer(item.fileUrl);
        const srcDoc = await PDFDocument.load(bytes);
        const copied = await out.copyPages(srcDoc, srcDoc.getPageIndices());
        copied.forEach((p) => out.addPage(p));
      } catch (err) {
        Toast.show(`Gagal memuat PDF ${item.tanggal} (${item.dinas}), dilewati.`, "warn");
      }
    }

    const bytes = await out.save();
    const base64 = this._toBase64(bytes);
    // Format: (BULAN)_STA (STASIUN)_(NAMA)_(JABATAN)_(NIPP).pdf
    // Contoh: AGUSTUS_STA GLENMORE_BUDI SANTOSO_PPKA_69123.pdf
    const fileName = buildNamaFileBulanan_(bulanNama, user);
    return { base64, fileName };
  },

  async _drawImageFitted(pdfDoc, page, photo) {
    const isPng = photo.mimeType && photo.mimeType.includes("png");
    const bytes = await (await fetch(photo.dataUrl)).arrayBuffer();
    const img = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
    const { width: pw, height: ph } = page.getSize();
    const margin = 24;
    const maxW = pw - margin * 2;
    const maxH = ph - margin * 2;
    const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
    const drawW = img.width * ratio;
    const drawH = img.height * ratio;
    page.drawImage(img, {
      x: (pw - drawW) / 2,
      y: (ph - drawH) / 2,
      width: drawW,
      height: drawH,
    });
  },

  async _fetchArrayBuffer(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    return await res.arrayBuffer();
  },

  _toBase64(bytes) {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  },
};

// ---------------------------------------------------------------------
// Wiring "Unduh IMO"
// ---------------------------------------------------------------------
function validateBeforeDownload() {
  let ok = true;

  const hasSmartcard = !!UploadSingle.state.smartcard;
  const hasDaftarHadir = !!UploadSingle.state.daftarHadir;

  document.getElementById("err-smartcard").closest(".field").classList.toggle("has-error", !hasSmartcard);
  document.getElementById("dzSmartcard").classList.toggle("is-invalid", !hasSmartcard);
  document.getElementById("err-daftarHadir").closest(".field").classList.toggle("has-error", !hasDaftarHadir);
  document.getElementById("dzDaftarHadir").classList.toggle("is-invalid", !hasDaftarHadir);

  if (!hasSmartcard || !hasDaftarHadir) ok = false;
  if (!ok) Toast.show("Lengkapi upload SmartCard & Daftar Hadir terlebih dahulu.", "error");
  return ok;
}

function wireUnduhImo() {
  document.getElementById("btnUnduhImo").addEventListener("click", async () => {
    if (!Session.current) { Toast.show("Silakan login terlebih dahulu.", "warn"); return; }
    if (!validateBeforeDownload()) return;

    const { bulanIdx, bulanNama, tahun } = MonthYear.get();
    const savedList = SavedPdfList.filteredSorted(bulanIdx, tahun);

    if (!savedList.length) {
      Toast.show(`Belum ada PDF harian tersimpan untuk ${bulanNama} ${tahun}. Tetap melanjutkan dengan Cover + SmartCard + Daftar Hadir saja.`, "warn");
    }

    try {
      Busy.show("MEMBUAT PDF…");
      const pdf = await PdfBulanan.build({
        user: Session.current,
        bulanNama,
        tahun,
        smartcard: UploadSingle.state.smartcard,
        daftarHadir: UploadSingle.state.daftarHadir,
        savedList,
      });

      Busy.show("MENYIMPAN KE GOOGLE DRIVE…");
      await Api.simpanImoBulanan({ user: Session.current, bulanNama, tahun, pdfFileName: pdf.fileName, pdfBase64: pdf.base64 });

      // Selain tersimpan ke Google Drive, PDF juga langsung diunduh ke perangkat.
      downloadBase64Pdf_(pdf.base64, pdf.fileName);

      Busy.hide();
      Toast.show(`Tersimpan sebagai "${pdf.fileName}" di ${CONFIG.DRIVE_ROOT_FOLDER}/${Session.current.stasiun}/${Session.current.jabatan}/${Session.current.nipp}/${tahun}/${bulanNama}/ dan sudah diunduh.`, "success");
    } catch (err) {
      Busy.hide();
      Toast.show("Gagal membuat/menyimpan IMO bulanan: " + err.message, "error");
    }
  });
}

// ---------------------------------------------------------------------
// Ajakan login (kalau belum login lewat dashboard IMO Tools)
// ---------------------------------------------------------------------
function wireLoginGate() {
  const btn = document.getElementById("btnGoLogin");
  if (!btn) return;
  btn.addEventListener("click", () => {
    try {
      if (window.parent && window.parent !== window && typeof window.parent.openLoginModal === "function") {
        window.parent.openLoginModal();
      } else {
        Toast.show("Buka menu utama IMO Tools untuk login.", "warn");
      }
    } catch (err) {
      Toast.show("Buka menu utama IMO Tools untuk login.", "warn");
    }
  });
}

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  Toast.init();
  wireLoginGate();
  UploadSingle.init();
  wireUnduhImo();

  const loggedIn = Session.load();

  const refreshList = () => {
    const { bulanIdx, tahun } = MonthYear.get();
    SavedPdfList.render(bulanIdx, tahun);
  };

  MonthYear.init(refreshList);

  if (loggedIn) {
    SavedPdfList.loadForUser(Session.current.nipp).then(refreshList);
  } else {
    Toast.show("Silakan login terlebih dahulu untuk membuat rekap IMO bulanan.", "warn");
  }
});
