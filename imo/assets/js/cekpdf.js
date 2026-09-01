/**
 * cekpdf.js
 * -----------------------------------------------------------------------
 * Fitur "Cek PDF Tersimpan": input NIPP -> tampilkan seluruh riwayat PDF
 * serah terima milik NIPP tersebut (dibaca dari sheet SerahTerima lewat
 * action "cekPdfTersimpan" di backend). Urutan hasil (tanggal termuda
 * dulu, lalu Dinas Pagi -> Siang -> Malam) sudah ditentukan di backend.
 * -----------------------------------------------------------------------
 */

const CekPdf = {
  init() {
    document.getElementById("btnCariPdf").addEventListener("click", () => this.cari());
    document.getElementById("cekNippInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.cari();
    });

    // Isi otomatis dengan NIPP user yang sedang login (tetap bisa diubah,
    // misal untuk cek riwayat NIPP lain), sesuai data sesi dari Form.
    if (Form.currentUser && Form.currentUser.nipp) {
      document.getElementById("cekNippInput").value = Form.currentUser.nipp;
    }
  },

  async cari() {
    const input = document.getElementById("cekNippInput");
    const nipp = input.value.trim();

    const statusEl = document.getElementById("cekPdfStatus");
    const resultWrap = document.getElementById("cekPdfResultWrap");
    const listEl = document.getElementById("cekPdfList");
    const captionEl = document.getElementById("cekPdfCaption");

    resultWrap.classList.add("hidden");
    listEl.innerHTML = "";

    if (!nipp) {
      this._setStatus(statusEl, "NIPP wajib diisi.", "error");
      return;
    }

    this._setStatus(statusEl, "Mencari…", "loading");

    try {
      const data = await Api.cariPdf(nipp);

      if (!data.found || !data.list || data.list.length === 0) {
        this._setStatus(statusEl, "Belum ada riwayat serah terima untuk NIPP ini.", "empty");
        return;
      }

      statusEl.classList.add("hidden");
      captionEl.textContent = `Ditemukan ${data.list.length} riwayat untuk NIPP ${nipp}, diurutkan dari tanggal terbaru (dimulai Dinas Pagi).`;
      data.list.forEach((item) => listEl.appendChild(this._buildRow(item)));
      resultWrap.classList.remove("hidden");
    } catch (err) {
      this._setStatus(statusEl, "Gagal mengambil data: " + err.message, "error");
    }
  },

  _buildRow(item) {
    const row = document.createElement("div");
    row.className = "cekpdf-row";

    const info = document.createElement("div");
    info.className = "cekpdf-row__info";
    info.innerHTML = `
      <div class="cekpdf-row__tanggal">${item.tanggal}</div>
      <div class="cekpdf-row__meta">
        <span class="badge badge--dinas">${item.dinas}</span>
        <span class="cekpdf-row__jenis">${item.jenisSerahTerima}</span>
      </div>
    `;

    const action = document.createElement("div");
    action.className = "cekpdf-row__action";
    if (item.fileUrl) {
      const link = document.createElement("a");
      link.href = item.fileUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.className = "btn btn--ghost btn--sm";
      link.textContent = "Buka PDF ↗";
      action.appendChild(link);
    } else {
      action.innerHTML = `<span class="cekpdf-row__nolink">Link tidak tersedia</span>`;
    }

    row.appendChild(info);
    row.appendChild(action);
    return row;
  },

  _setStatus(el, text, type) {
    el.classList.remove("hidden");
    el.textContent = text;
    el.className = `cekpdf-status cekpdf-status--${type}`;
  },
};
