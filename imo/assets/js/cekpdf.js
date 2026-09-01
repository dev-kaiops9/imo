/**
 * cekpdf.js
 * -----------------------------------------------------------------------
 * PLACEHOLDER SEMENTARA — file asli tidak berhasil dipulihkan dari backup.
 * Pencarian riwayat PDF berdasarkan NIPP masih stub sampai backend
 * (Google Sheet/Drive via Apps Script) disambungkan kembali.
 * -----------------------------------------------------------------------
 */

const CekPdf = {
  init() {
    document.getElementById("btnCariPdf").addEventListener("click", () => this.search());
    document.getElementById("cekNippInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.search();
    });

    // Isi otomatis dengan NIPP user yang sedang login (tetap bisa diubah,
    // misal untuk cek riwayat NIPP lain), sesuai data sesi dari Form.
    if (Form.currentUser && Form.currentUser.nipp) {
      document.getElementById("cekNippInput").value = Form.currentUser.nipp;
    }
  },

  async search() {
    const nipp = document.getElementById("cekNippInput").value.trim();
    const statusEl = document.getElementById("cekPdfStatus");
    const resultWrap = document.getElementById("cekPdfResultWrap");

    if (!nipp) {
      Toast.show("Masukkan NIPP terlebih dahulu.", "error");
      return;
    }

    statusEl.classList.remove("hidden");
    statusEl.textContent = "Mencari…";
    resultWrap.classList.add("hidden");

    const result = await Api.cariPdf(nipp);

    if (!result.found) {
      statusEl.textContent = "Fitur pencarian belum tersambung ke backend Apps Script.";
      return;
    }

    statusEl.classList.add("hidden");
    resultWrap.classList.remove("hidden");
    document.getElementById("cekPdfCaption").textContent = `Ditemukan ${result.items.length} PDF untuk NIPP ${nipp}`;
    document.getElementById("cekPdfList").innerHTML = result.items
      .map((it) => `<div class="cekpdf-item">${it.name}</div>`)
      .join("");
  },
};
