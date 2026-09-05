/**
 * api.js
 * -----------------------------------------------------------------------
 * Semua komunikasi ke backend Google Apps Script lewat di sini.
 * Apps Script Web App hanya mengenal query string (GET) atau body teks
 * biasa (POST) — dikirim sebagai text/plain agar browser tidak melakukan
 * CORS preflight (Apps Script tidak bisa membalas preflight OPTIONS).
 * -----------------------------------------------------------------------
 */

const Toast = {
  el: null,
  init() {
    this.el = document.getElementById("toastStack");
  },
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
    }, 3000);
  },
};

const Api = {
  async _post(payload) {
    const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`Server merespons status ${res.status}`);
    }

    const json = await res.json();
    if (json.ok === false) {
      throw new Error(json.message || "Terjadi kesalahan pada server.");
    }
    return json;
  },

  /**
   * Cek NIPP ke sheet Pegawai.
   * @param {string} nipp
   * @returns {Promise<{found: boolean, data?: {nama, jabatan, stasiun}}>}
   */
  async cekNipp(nipp) {
    const json = await this._post({ action: "cekNipp", nipp });
    return json.data;
  },

  /**
   * Ambil daftar PDF Tersimpan milik satu NIPP dari sheet SerahTerima.
   * Dipakai untuk widget sidebar "PDF Tersimpan" di dashboard, DAN untuk
   * validasi tanggal duplikat di halaman ini (lihat Form.checkTanggalDuplikat
   * di form.js) sebelum user menekan "Lanjut →" pada Langkah 1.
   * @param {string} nipp
   * @returns {Promise<{found: boolean, list: Array<{tanggal, dinas, jenisSerahTerima, fileUrl}>}>}
   */
  async cekPdfTersimpan(nipp) {
    const json = await this._post({ action: "cekPdfTersimpan", nipp });
    return json.data;
  },

  /**
   * Kirim seluruh data serah terima (form + foto sudah tertempel di PDF
   * base64) ke backend — PDF disimpan ke Google Drive dan baris baru
   * dicatat ke sheet SerahTerima.
   * @param {object} data hasil Form.collect()
   * @param {object} pdf hasil Pdf.build(data): { base64, fileName }
   * @returns {Promise<{pdfUrl: string, folderUrl: string}>}
   */
  async saveSerahTerima(data, pdf) {
    const json = await this._post({
      action: "simpanData",
      payload: {
        nipp: data.nipp,
        nama: data.nama,
        jabatan: data.jabatan,
        stasiun: data.stasiun,
        dinas: data.dinas,
        tanggal: data.tanggal,
        jenisSerahTerima: data.jenisSerahTerima,
        employeeFound: data.employeeFound,
        tabel: data.mapping.tabel,
        driveRootFolder: CONFIG.DRIVE_ROOT_FOLDER,
        pdfFileName: pdf.fileName,
        pdfBase64: pdf.base64,
        // Foto "Serah Terima" & "Dokumentasi Kegiatan" TIDAK dikirim
        // terpisah — sudah tertempel di dalam PDF ini.
      },
    });
    return json.data;
  },
};
