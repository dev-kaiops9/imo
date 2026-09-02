/**
 * bulanan.js
 * -----------------------------------------------------------------------
 * Logika halaman "IMO - Per Bulan":
 *  1. Dropdown Bulan & Tahun (untuk cover + filter daftar PDF tersimpan).
 *  2. Upload SmartCard (lihat SmartcardWidget, poin 2b) & Upload Daftar
 *     Hadir (UploadSingle) — 1 foto masing-masing.
 *  2b. SmartCard bersifat 1 file per pegawai, DIPAKAI ULANG lintas bulan
 *     (beda dengan Daftar Hadir yang wajib upload baru tiap bulan). Saat
 *     halaman dibuka, SmartcardWidget.checkExisting() cek ke backend
 *     (action "cekSmartcard") apakah pegawai ini sudah punya SmartCard
 *     tersimpan di Drive — kalau ada, widget langsung terisi otomatis
 *     (tanpa perlu upload ulang) dan tombol "Lihat SmartCard" muncul,
 *     membuka popup preview dengan tombol "Perbarui SmartCard" / "Kembali".
 *     Foto SmartCard baru/hasil "Perbarui" baru benar-benar dikirim &
 *     ditimpa ke Drive saat "Unduh IMO" diklik (lihat
 *     SmartcardWidget.getUploadPayload()).
 *  3. Daftar PDF Tersimpan bulan/tahun terpilih (sumber: action backend
 *     "cekPdfTersimpan", sama seperti dipakai widget "PDF Tersimpan" di
 *     sidebar kanan dashboard) — diurutkan tanggal termuda dulu, lalu
 *     Dinas Pagi -> Siang -> Malam pada tanggal yang sama.
 *  4. Tombol "Unduh IMO": menggabungkan Cover + SmartCard (landscape) +
 *     Daftar Hadir + seluruh PDF tersimpan di atas menjadi SATU file PDF
 *     (pakai pdf-lib), lalu mengirimkannya ke backend untuk disimpan ke
 *     Google Drive dengan struktur folder yang SAMA seperti menu Per Hari:
 *     {DRIVE_ROOT_FOLDER}/{Stasiun}/{Jabatan}/{NIPP}/ — SmartCard (kalau
 *     baru/berubah) ikut disimpan pada request yang sama, tapi ke folder
 *     TERPISAH: {DRIVE_ROOT_FOLDER}/{Stasiun}/{Jabatan}/{NIPP}/SmartCard/
 *
 * CATATAN PENTING (backend):
 * Pengiriman ke backend memakai action "simpanImoBulanan" & "cekSmartcard"
 * (lihat objek Api di bawah) — keduanya HARUS ada di Google Apps Script
 * (Code.gs), sudah ditambahkan dengan pola yang sama seperti action
 * "simpanData" (dipakai menu Per Hari).
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
  show(text, opts) {
    document.getElementById("busyText").textContent = text || "MEMPROSES…";
    document.getElementById("busyOverlay").classList.add("is-open");
    const showProgress = !!(opts && opts.progress);
    document.getElementById("busyProgressWrap").classList.toggle("hidden", !showProgress);
    if (showProgress) this.setProgress(0);
  },
  setProgress(pct) {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    document.getElementById("busyProgressFill").style.width = clamped + "%";
    document.getElementById("busyProgressPct").textContent = clamped + "%";
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
// Upload foto tunggal (Daftar Hadir) — pola sama dengan UploadField di
// menu Per Hari, tapi cuma 1 foto. SmartCard PUNYA MODUL SENDIRI
// (SmartcardWidget, di bawah) karena state-nya lebih kompleks: bisa
// "sudah tersimpan dari Drive" (tidak wajib upload ulang), bukan cuma
// "sudah dipilih / belum".
// ---------------------------------------------------------------------
const UploadSingle = {
  state: { daftarHadir: null },

  init() {
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
    const errEl = document.getElementById("err-daftarHadir");
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
// Widget SmartCard — beda dari UploadSingle karena punya 3 kemungkinan
// tampilan (checking / wajib upload / sudah tersimpan) dan popup preview
// dengan tombol "Perbarui SmartCard".
//
// state.data  : { dataUrl, mimeType, fileName } | null — foto yang aktif
//               dipakai saat ini (dari Drive ATAU dari pilihan baru user).
// state.isNew : true kalau state.data ini BARU dipilih user (upload
//               pertama kali / hasil "Perbarui SmartCard") — dipakai
//               Api.simpanImoBulanan untuk memutuskan apakah perlu kirim
//               ulang base64-nya ke backend untuk ditimpa ke Drive, atau
//               tidak perlu sama sekali kalau user pakai foto lama apa
//               adanya (sudah ada di Drive, tidak diubah).
// ---------------------------------------------------------------------
const SmartcardWidget = {
  state: { data: null, isNew: false },
  els: {},

  init() {
    this.els = {
      checking: document.getElementById("smartcardCheckingState"),
      uploadState: document.getElementById("smartcardUploadState"),
      existingState: document.getElementById("smartcardExistingState"),
      existingThumb: document.getElementById("smartcardExistingThumb"),
      dz: document.getElementById("dzSmartcard"),
      input: document.getElementById("fileSmartcard"),
      thumbWrap: document.getElementById("thumbSmartcard"),
      err: document.getElementById("err-smartcard"),
      btnLihat: document.getElementById("btnLihatSmartcard"),
      overlay: document.getElementById("smartcardOverlay"),
      previewImg: document.getElementById("smartcardPreviewImg"),
      btnKembali: document.getElementById("btnKembaliSmartcard"),
      btnPerbarui: document.getElementById("btnPerbaruiSmartcard"),
      inputUpdate: document.getElementById("fileSmartcardUpdate"),
    };
    this._wireDropzone();
    this._wirePopup();
  },

  showChecking() {
    this.els.checking.classList.remove("hidden");
    this.els.uploadState.classList.add("hidden");
    this.els.existingState.classList.add("hidden");
  },

  showUploadNeeded() {
    this.els.checking.classList.add("hidden");
    this.els.uploadState.classList.remove("hidden");
    this.els.existingState.classList.add("hidden");
  },

  showExisting(data) {
    this.state.data = data;
    this.els.checking.classList.add("hidden");
    this.els.uploadState.classList.add("hidden");
    this.els.existingState.classList.remove("hidden");
    this.els.existingThumb.src = data.dataUrl;
    this._clearError();
  },

  /** Dipanggil sekali saat halaman dimuat (setelah login) — cek ke backend
   *  apakah pegawai ini sudah punya SmartCard tersimpan di Drive. */
  async checkExisting(user) {
    this.showChecking();
    try {
      const result = await Api.cekSmartcard(user);
      if (result && result.found) {
        this.state.isNew = false; // berasal dari Drive, BUKAN pilihan baru
        this.showExisting({
          dataUrl: `data:${result.mimeType};base64,${result.base64}`,
          mimeType: result.mimeType,
          fileName: result.fileName,
        });
        return;
      }
    } catch (err) {
      Toast.show("Gagal memeriksa SmartCard tersimpan: " + err.message, "warn");
    }
    this.showUploadNeeded();
  },

  _wireDropzone() {
    const { dz, input, thumbWrap } = this.els;
    if (!dz || !input) return;

    const openPicker = () => input.click();
    dz.addEventListener("click", openPicker);
    dz.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(); }
    });

    input.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) this._applyNewFile(file, thumbWrap, dz);
      input.value = "";
    });

    ["dragenter", "dragover"].forEach((evt) => {
      dz.addEventListener(evt, (e) => { e.preventDefault(); dz.classList.add("is-dragover"); });
    });
    ["dragleave", "drop"].forEach((evt) => {
      dz.addEventListener(evt, (e) => { e.preventDefault(); dz.classList.remove("is-dragover"); });
    });
    dz.addEventListener("drop", (e) => {
      const file = e.dataTransfer.files[0];
      if (file) this._applyNewFile(file, thumbWrap, dz);
    });
  },

  _wirePopup() {
    const { btnLihat, overlay, previewImg, btnKembali, btnPerbarui, inputUpdate } = this.els;
    if (!btnLihat || !overlay) return;

    const open = () => {
      if (!this.state.data) return;
      previewImg.src = this.state.data.dataUrl;
      overlay.classList.add("is-open");
      overlay.setAttribute("aria-hidden", "false");
    };
    const close = () => {
      overlay.classList.remove("is-open");
      overlay.setAttribute("aria-hidden", "true");
    };

    btnLihat.addEventListener("click", open);
    btnKembali.addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    // "Perbarui SmartCard" -> buka file picker tersembunyi. Foto yang
    // dipilih LANGSUNG menggantikan tampilan widget (state "sudah
    // tersimpan" dengan foto baru) + popup ditutup. Foto ini baru benar-
    // benar dikirim & ditimpa ke Drive nanti saat klik "Unduh IMO"
    // (lihat Api.simpanImoBulanan / getUploadPayload di bawah).
    btnPerbarui.addEventListener("click", () => inputUpdate.click());
    inputUpdate.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      inputUpdate.value = "";
      if (!file) return;
      const ok = await this._applyNewFile(file, null, null);
      if (ok) {
        close();
        Toast.show('SmartCard diperbarui. Perubahan tersimpan ke Drive saat klik "Unduh IMO".', "info");
      }
    });
  },

  /** Validasi + terapkan foto baru (dari dropzone ATAU popup "Perbarui
   *  SmartCard") sebagai state aktif, lalu tampilkan widget dalam kondisi
   *  "sudah tersimpan" (foto baru ini). Return true kalau berhasil. */
  async _applyNewFile(file, thumbWrap, dz) {
    if (!file.type.startsWith("image/")) { Toast.show("File yang dipilih bukan gambar.", "error"); return false; }
    if (file.size > 8 * 1024 * 1024) { Toast.show("Ukuran foto maksimal 8MB.", "error"); return false; }

    const dataUrl = await this._readAsDataURL(file);
    this.state.isNew = true; // wajib dikirim & ditimpa ke Drive saat "Unduh IMO"

    if (dz) dz.classList.remove("is-invalid");
    if (thumbWrap) thumbWrap.innerHTML = "";

    this.showExisting({ dataUrl, mimeType: file.type, fileName: file.name });
    return true;
  },

  _clearError() {
    const field = this.els.err && this.els.err.closest(".field");
    if (field) field.classList.remove("has-error");
    if (this.els.dz) this.els.dz.classList.remove("is-invalid");
  },

  _readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  /** Payload tambahan untuk action "simpanImoBulanan" — base64 HANYA
   *  disertakan kalau foto SmartCard aktif ini baru/berubah (isNew).
   *  Kalau user memakai foto lama dari Drive apa adanya, return null
   *  (tidak perlu kirim ulang & tidak perlu ditimpa di backend). */
  getUploadPayload() {
    if (!this.state.data || !this.state.isNew) return null;
    const base64 = this.state.data.dataUrl.split(",")[1];
    return { smartcardBase64: base64, smartcardMimeType: this.state.data.mimeType };
  },

  /** Dipanggil setelah "Unduh IMO" berhasil menyimpan — foto aktif saat
   *  ini sudah tercatat di Drive, jadi tidak "baru" lagi kalau user
   *  langsung mengulang proses tanpa mengubah apa pun. */
  markSaved() {
    this.state.isNew = false;
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
   * Cek apakah pegawai aktif sudah punya foto SmartCard tersimpan di
   * Drive (folder {DRIVE_ROOT_FOLDER}/{Stasiun}/{Jabatan}/{NIPP}/SmartCard/).
   * @param {object} user { nipp, jabatan, stasiun }
   * @returns {Promise<{found: boolean, base64?: string, mimeType?: string, fileName?: string}>}
   */
  async cekSmartcard(user) {
    const json = await this._post({
      action: "cekSmartcard",
      payload: {
        nipp: user.nipp,
        jabatan: user.jabatan,
        stasiun: user.stasiun,
        driveRootFolder: CONFIG.DRIVE_ROOT_FOLDER,
      },
    });
    return json.data || { found: false };
  },

  /**
   * Kirim PDF gabungan (Cover + SmartCard + Daftar Hadir + PDF harian) ke
   * backend untuk disimpan ke Drive — folder SAMA persis dengan menu Per
   * Hari ({DRIVE_ROOT_FOLDER}/{Stasiun}/{Jabatan}/{NIPP}/).
   *
   * PERLU DITAMBAHKAN di Code.gs: action "simpanImoBulanan" (lihat
   * catatan di kepala file ini).
   *
   * @param {object|null} smartcardPayload hasil SmartcardWidget.getUploadPayload()
   *   — { smartcardBase64, smartcardMimeType } kalau SmartCard baru/berubah,
   *   atau null kalau user memakai SmartCard lama dari Drive apa adanya
   *   (tidak perlu kirim ulang/ditimpa).
   */
  async simpanImoBulanan({ user, bulanNama, tahun, pdfFileName, pdfBase64, smartcardPayload }) {
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
        ...(smartcardPayload || {}),
      },
    });
    return json.data || {};
  },

  /**
   * Ambil isi (base64) satu file PDF harian yang tersimpan di Drive, LEWAT
   * BACKEND (bukan fetch langsung ke drive.google.com dari browser).
   *
   * Kenapa tidak fetch(item.fileUrl) langsung? Karena item.fileUrl adalah
   * URL viewer Drive ("/file/d/{ID}/view"), bukan file mentah, DAN
   * drive.google.com tidak mengirim header CORS yang mengizinkan situs ini
   * membaca responsnya — browser akan memblokir fetch tsb (gagal total,
   * bukan cuma lambat). Solusinya: Apps Script (server) yang punya akses
   * langsung ke Drive (tanpa batasan CORS) yang mengambil bytes file lalu
   * mengirimkannya sebagai base64 ke frontend lewat action
   * "ambilPdfBase64" (lihat Code.gs).
   *
   * @param {string} fileId ID file Drive (diparse dari fileUrl)
   * @returns {Promise<string>} base64 isi PDF
   */
  async ambilPdfBase64(fileId) {
    const json = await this._post({ action: "ambilPdfBase64", fileId });
    if (!json.data || !json.data.base64) {
      throw new Error("Backend tidak mengembalikan isi file.");
    }
    return json.data.base64;
  },
};

/**
 * Ekstrak ID file Drive dari URL viewer standar yang dihasilkan
 * file.getUrl() di Apps Script, contoh:
 *   https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=drivesdk
 * Juga menangani variasi lain seperti "...?id=" atau "/open?id=...".
 */
function extractDriveFileId_(url) {
  const str = String(url || "");
  let m = str.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  m = str.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  return null;
}

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
//   Hal 1: Cover (sesuai desain — logo Danantara/KAI + foto kereta di kanan)
//   Hal 2: Foto SmartCard (landscape)
//   Hal 3: Foto Daftar Hadir
//   Hal 4-selesai: gabungan PDF harian (urutan sudah difilter+diurutkan)
// ---------------------------------------------------------------------
const PdfBulanan = {
  async build({ user, bulanNama, tahun, smartcard, daftarHadir, savedList, onProgress }) {
    const report = typeof onProgress === "function" ? onProgress : () => {};

    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const out = await PDFDocument.create();
    const fontBold = await out.embedFont(StandardFonts.HelveticaBold);
    const fontRegular = await out.embedFont(StandardFonts.Helvetica);

    const A4_LANDSCAPE = [841.89, 595.28];

    // ---- Halaman 1: Cover ----
    const cover = out.addPage(A4_LANDSCAPE);
    await this._drawCoverPage(out, cover, { fontBold, fontRegular, bulanNama, tahun, user });
    report(5);

    // ---- Halaman 2: Foto SmartCard (landscape) ----
    if (smartcard) {
      const page = out.addPage(A4_LANDSCAPE);
      await this._drawHeaderedPhotoPage(out, page, { fontBold, title: "SMARTCARD", photo: smartcard });
    }
    report(10);

    // ---- Halaman 3: Foto Daftar Hadir ----
    if (daftarHadir) {
      const page = out.addPage(A4_LANDSCAPE);
      const title = `DAFTAR HADIR BULAN ${String(bulanNama).toUpperCase()} ${tahun}`;
      await this._drawHeaderedPhotoPage(out, page, { fontBold, title, photo: daftarHadir });
    }
    report(15);

    // ---- Halaman 4-selesai: gabungan PDF harian tersimpan ----
    // Diambil LEWAT BACKEND (Api.ambilPdfBase64), bukan fetch langsung ke
    // drive.google.com — lihat komentar di Api.ambilPdfBase64 kenapa fetch
    // langsung selalu gagal (CORS + URL yang diambil bukan file mentah).
    // Rentang progres 15% - 85% dibagi rata ke tiap PDF harian yang digabung.
    const total = savedList.length;
    for (let i = 0; i < total; i++) {
      const item = savedList[i];
      if (item.fileUrl) {
        try {
          const fileId = extractDriveFileId_(item.fileUrl);
          if (!fileId) throw new Error("ID file tidak ditemukan pada URL tersimpan.");
          const base64 = await Api.ambilPdfBase64(fileId);
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          const srcDoc = await PDFDocument.load(bytes);
          const copied = await out.copyPages(srcDoc, srcDoc.getPageIndices());
          copied.forEach((p) => out.addPage(p));
        } catch (err) {
          Toast.show(`Gagal memuat PDF ${item.tanggal} (${item.dinas}), dilewati. (${err.message})`, "warn");
        }
      }
      report(15 + Math.round(((i + 1) / Math.max(total, 1)) * 70));
    }

    report(88);
    const bytes = await out.save();
    report(92);
    const base64 = this._toBase64(bytes);
    // Format: (BULAN)_STA (STASIUN)_(NAMA)_(JABATAN)_(NIPP).pdf
    // Contoh: AGUSTUS_STA GLENMORE_BUDI SANTOSO_PPKA_69123.pdf
    const fileName = buildNamaFileBulanan_(bulanNama, user);
    return { base64, fileName };
  },

  /**
   * Menggambar Halaman 1 (Cover) — LANGSUNG PAKAI GAMBAR DESAIN cover yang
   * diberikan (assets/img/cover-background.jpg) sebagai background 1
   * halaman penuh (logo Danantara, logo KAI, foto kereta, kartu abu-abu,
   * garis aksen, & label "Nama/NIPP/Jabatan/Unit Kerja/DAOP" SEMUA sudah
   * jadi bagian dari gambar ini, apa adanya).
   *
   * Yang di-generate ulang secara dinamis (ditimpa di atas background,
   * pakai warna kartu yang sama supaya menyatu) hanya BAGIAN YANG BERUBAH
   * per pegawai/bulan:
   *   - 3 baris judul ("Laporan Kegiatan" / "Pengoperasian" / "Bulan {Bulan} {Tahun}")
   *   - nilai di kolom kanan tiap baris identitas (Nama/NIPP/Jabatan/Unit Kerja/DAOP)
   *
   * Koordinat di bawah (dalam px, lalu dikonversi ke pt lewat COVER_SCALE)
   * diukur langsung dari file assets/img/cover-background.jpg
   * (3508 x 2480 px = A4 landscape @300dpi). Kalau gambar background ini
   * diganti dengan desain baru yang layout-nya beda, angka-angka ini perlu
   * diukur ulang.
   */
  async _drawCoverPage(pdfDoc, page, { fontBold, fontRegular, bulanNama, tahun, user }) {
    const { rgb } = PDFLib;
    const { width: pw, height: ph } = page.getSize();

    const INK = rgb(0.07, 0.08, 0.11);
    const INK_SOFT = rgb(0.18, 0.19, 0.22);
    // Warna "kartu" abu-abu sangat muda di background — dipakai untuk
    // menimpa teks contoh sebelum menulis nilai yang sebenarnya, supaya
    // tidak ada bekas kotak putih yang kelihatan beda dari sekitarnya.
    const CARD_BG = rgb(0.988, 0.988, 0.988);

    // ---- Gambar background (1 halaman penuh) ----
    const bgBytes = await this._fetchArrayBuffer("assets/img/cover-background.jpg");
    const bgImg = await pdfDoc.embedJpg(bgBytes);
    page.drawImage(bgImg, { x: 0, y: 0, width: pw, height: ph });

    // Skala px (ukuran asli gambar) -> pt (ukuran halaman PDF).
    const scale = bgImg.width / pw; // ~4.1667 untuk aset 3508x2480 di halaman A4

    /** px (dari kiri-atas gambar) -> pt (dari kiri-bawah halaman PDF). */
    const X = (px) => px / scale;
    const Y = (pxFromTop) => ph - pxFromTop / scale;
    const H = (pxHeight) => pxHeight / scale;

    // ==================== JUDUL (3 baris) ====================
    // Kotak judul di dalam kartu (px, hasil ukur langsung di gambar).
    const titleBox = { x0: 63, x1: 1320, yTop: 715, yBottom: 1210 };
    page.drawRectangle({
      x: X(titleBox.x0),
      y: Y(titleBox.yBottom),
      width: X(titleBox.x1) - X(titleBox.x0),
      height: H(titleBox.yBottom - titleBox.yTop),
      color: CARD_BG,
    });

    const titleLines = ["Laporan Kegiatan", "Pengoperasian", `Bulan ${bulanNama} ${tahun}`];
    const titleMaxWidth = X(titleBox.x1) - X(titleBox.x0);
    let titleSize = 32; // besar & tegas, TIDAK di-auto-shrink kecuali kepanjangan
    const titleFloor = 22;
    titleLines.forEach((line) => {
      while (titleSize > titleFloor && fontBold.widthOfTextAtSize(line, titleSize) > titleMaxWidth) {
        titleSize -= 0.5;
      }
    });
    const titleLineH = titleSize * 1.24;
    // Baris pertama diposisikan sejajar dengan baris pertama judul asli di gambar.
    let titleBaseline = Y(872); // px 872 = batas bawah baris "Laporan Kegiatan" di gambar
    titleLines.forEach((line) => {
      page.drawText(line, { x: X(titleBox.x0), y: titleBaseline, size: titleSize, font: fontBold, color: INK });
      titleBaseline -= titleLineH;
    });

    // ==================== LABEL "NAMA" (perbaikan huruf kapital) ====================
    // Di gambar background, label baris pertama masih tertulis "Nama" (Title
    // Case), sedangkan label lain (NIPP/JABATAN/UNIT KERJA/DAOP) sudah UPPERCASE.
    // Area label ini ditimpa warna kartu lalu ditulis ulang jadi "NAMA" pakai
    // font bold, supaya konsisten dengan label baris lainnya.
    const namaLabelBox = { x0: 110, x1: 310, yTop: 1294, yBottom: 1372 };
    page.drawRectangle({
      x: X(namaLabelBox.x0),
      y: Y(namaLabelBox.yBottom),
      width: X(namaLabelBox.x1) - X(namaLabelBox.x0),
      height: H(namaLabelBox.yBottom - namaLabelBox.yTop),
      color: CARD_BG,
    });
    page.drawText("NAMA", { x: X(123), y: Y(1350), size: 14.5, font: fontBold, color: INK });

    // ==================== BARIS IDENTITAS ====================
    // Untuk tiap baris: hanya kolom NILAI (kanan) yang ditimpa & ditulis
    // ulang — label ("NIPP", "JABATAN", dst.) & tanda titik dua sudah ada di
    // gambar dan tidak disentuh (label "Nama" ditimpa terpisah di atas).
    const valueX = 567; // px — posisi mulai teks nilai (persis setelah titik dua)
    const valueRightEdge = 1320; // px — tepi kanan kartu

    // UNIT KERJA selalu diawali "Stasiun " (kalau nilainya belum diawali kata itu).
    const stasiunRaw = String(user.stasiun || "-").trim();
    const stasiunValue =
      stasiunRaw === "-" || /^stasiun\b/i.test(stasiunRaw) ? stasiunRaw : `Stasiun ${stasiunRaw}`;

    const rows = [
      { label: "NAMA", value: user.nama || "-", yTop: 1294, yBottom: 1372, baseline: 1350 },
      { label: "NIPP", value: user.nipp || "-", yTop: 1395, yBottom: 1472, baseline: 1450 },
      { label: "JABATAN", value: user.jabatan || "-", yTop: 1497, yBottom: 1574, baseline: 1552 },
      { label: "UNIT KERJA", value: stasiunValue, yTop: 1597, yBottom: 1675, baseline: 1653 },
      { label: "DAOP", value: "9 Jember", yTop: 1698, yBottom: 1776, baseline: 1754 },
    ];

    const fieldSize = 16;
    const fieldMinSize = 12;
    const valueMaxWidth = X(valueRightEdge) - X(valueX);

    rows.forEach((row) => {
      // Timpa nilai contoh dengan warna kartu (label & ":" di kirinya tidak disentuh).
      page.drawRectangle({
        x: X(valueX),
        y: Y(row.yBottom),
        width: X(valueRightEdge) - X(valueX),
        height: H(row.yBottom - row.yTop),
        color: CARD_BG,
      });

      const value = String(row.value);
      let valueSize = fieldSize;
      while (valueSize > fieldMinSize && fontRegular.widthOfTextAtSize(value, valueSize) > valueMaxWidth) {
        valueSize -= 0.5;
      }

      let valueLines = [value];
      if (fontRegular.widthOfTextAtSize(value, valueSize) > valueMaxWidth) {
        valueLines = this._wrapTextToLines(fontRegular, value, valueSize, valueMaxWidth, 2);
      }

      const valueLineH = valueSize * 1.15;
      const baseY = Y(row.baseline);
      valueLines.forEach((line, i) => {
        page.drawText(line, { x: X(valueX), y: baseY + (valueLines.length - 1 - i) * valueLineH, size: valueSize, font: fontRegular, color: INK_SOFT });
      });
    });
  },

  /**
   * Membungkus teks jadi beberapa baris berdasarkan lebar maksimum, mirip
   * doc.splitTextToSize() di jsPDF (dipakai di pdf.js) tapi versi pdf-lib.
   * Baris terakhir yang masih kepanjangan akan dipotong + diberi "…".
   */
  _wrapTextToLines(font, text, size, maxWidth, maxLines) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";

    words.forEach((word) => {
      const candidate = current ? `${current} ${word}` : word;
      if (!current || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    });
    if (current) lines.push(current);

    if (lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      let last = kept[maxLines - 1];
      while (last.length > 1 && font.widthOfTextAtSize(`${last}…`, size) > maxWidth) {
        last = last.slice(0, -1);
      }
      kept[maxLines - 1] = `${last}…`;
      return kept;
    }
    return lines;
  },

  /**
   * Halaman berisi 1 judul (header) di atas + 1 foto yang diperbesar
   * memenuhi SISA halaman (bukan cuma ukuran asli fotonya) — dipakai untuk
   * halaman SmartCard & Daftar Hadir.
   *
   * Foto SELALU diperbesar (ratio TIDAK dibatasi maksimum 1x) sampai
   * menyentuh salah satu sisi area yang tersedia, supaya foto kecil
   * sekalipun tetap terlihat penuh 1 halaman — hanya menyisakan sedikit
   * jarak di kanan/kiri/bawah, dan tidak menutupi header di atas.
   */
  async _drawHeaderedPhotoPage(pdfDoc, page, { fontBold, title, photo }) {
    const { rgb } = PDFLib;
    const { width: pw, height: ph } = page.getSize();
    const INK = rgb(0.07, 0.08, 0.11);
    const LINE = rgb(0.85, 0.85, 0.85);

    // ---- Header ----
    const headerSize = 22;
    const headerY = ph - 40; // baseline judul, 40pt dari atas halaman
    const headerW = fontBold.widthOfTextAtSize(title, headerSize);
    page.drawText(title, { x: (pw - headerW) / 2, y: headerY, size: headerSize, font: fontBold, color: INK });

    const dividerY = headerY - 16;
    page.drawLine({ start: { x: 40, y: dividerY }, end: { x: pw - 40, y: dividerY }, thickness: 1, color: LINE });

    // ---- Area foto: sisa halaman di bawah header, sedikit ruang di semua sisi ----
    const sideMargin = 20;
    const bottomMargin = 20;
    const topGap = 16; // jarak dari garis pembatas ke foto, supaya tidak menempel header
    const areaLeft = sideMargin;
    const areaRight = pw - sideMargin;
    const areaTop = dividerY - topGap;
    const areaBottom = bottomMargin;
    const maxW = areaRight - areaLeft;
    const maxH = areaTop - areaBottom;

    const isPng = photo.mimeType && photo.mimeType.includes("png");
    const bytes = await (await fetch(photo.dataUrl)).arrayBuffer();
    const img = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);

    // TANPA batas ", 1" — foto selalu diperbesar sampai memenuhi area,
    // berapa pun ukuran aslinya (sesuai permintaan: "buat full 1 halaman").
    const ratio = Math.min(maxW / img.width, maxH / img.height);
    const drawW = img.width * ratio;
    const drawH = img.height * ratio;
    page.drawImage(img, {
      x: areaLeft + (maxW - drawW) / 2,
      y: areaBottom + (maxH - drawH) / 2,
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

  // SmartCard valid kalau state-nya terisi — baik dari upload baru MAUPUN
  // dari hasil "sudah ada di Drive" yang otomatis ke-load (lihat
  // SmartcardWidget.checkExisting). Error/highlight cuma relevan kalau
  // tampilannya sedang di state "wajib upload" (dzSmartcard).
  const hasSmartcard = !!SmartcardWidget.state.data;
  const hasDaftarHadir = !!UploadSingle.state.daftarHadir;

  const smartcardErrField = document.getElementById("err-smartcard").closest(".field");
  const dzSmartcard = document.getElementById("dzSmartcard");
  if (smartcardErrField) smartcardErrField.classList.toggle("has-error", !hasSmartcard);
  if (dzSmartcard) dzSmartcard.classList.toggle("is-invalid", !hasSmartcard);

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
      // Tahap 1 (0% - 92%): menyusun & menggabungkan seluruh halaman PDF.
      Busy.show("MEMBUAT PDF…", { progress: true });
      const pdf = await PdfBulanan.build({
        user: Session.current,
        bulanNama,
        tahun,
        smartcard: SmartcardWidget.state.data,
        daftarHadir: UploadSingle.state.daftarHadir,
        savedList,
        onProgress: (pct) => Busy.setProgress(pct),
      });

      // Tahap 2 (92% - 97%): mengunggah/menyimpan PDF akhir ke Google Drive.
      // smartcardPayload cuma terisi (dan dikirim) kalau foto SmartCard-nya
      // baru/berubah — lihat SmartcardWidget.getUploadPayload().
      Busy.show("MENYIMPAN PDF…", { progress: true });
      Busy.setProgress(92);
      await Api.simpanImoBulanan({
        user: Session.current, bulanNama, tahun,
        pdfFileName: pdf.fileName, pdfBase64: pdf.base64,
        smartcardPayload: SmartcardWidget.getUploadPayload(),
      });
      SmartcardWidget.markSaved();
      Busy.setProgress(97);

      // Tahap 3 (97% - 100%): mengunduh PDF ke perangkat.
      Busy.show("MENDOWNLOAD PDF…", { progress: true });
      Busy.setProgress(97);
      downloadBase64Pdf_(pdf.base64, pdf.fileName);
      Busy.setProgress(100);

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
  SmartcardWidget.init();
  wireUnduhImo();

  const loggedIn = Session.load();

  const refreshList = () => {
    const { bulanIdx, tahun } = MonthYear.get();
    SavedPdfList.render(bulanIdx, tahun);
  };

  MonthYear.init(refreshList);

  if (loggedIn) {
    SavedPdfList.loadForUser(Session.current.nipp).then(refreshList);
    SmartcardWidget.checkExisting(Session.current);
  } else {
    Toast.show("Silakan login terlebih dahulu untuk membuat rekap IMO bulanan.", "warn");
  }
});
