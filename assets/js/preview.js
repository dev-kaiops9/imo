/**
 * preview.js
 * -----------------------------------------------------------------------
 * Mengisi & menampilkan overlay preview dokumen sebelum data benar-benar
 * disimpan. Tombol "Simpan" pada overlay ini memicu proses akhir di
 * main.js (generate PDF -> upload -> simpan sheet).
 * -----------------------------------------------------------------------
 */

const Preview = {
  open(data, photos) {
    document.getElementById("pv-nipp").textContent = data.nipp;
    document.getElementById("pv-nama").textContent = data.nama;
    document.getElementById("pv-jabatan").textContent = data.jabatan;
    document.getElementById("pv-stasiun").textContent = data.stasiun;
    document.getElementById("pv-dinas").textContent = data.dinas;
    document.getElementById("pv-tanggal").textContent = this._formatTanggal(data.tanggal);
    document.getElementById("pv-jenis").textContent = data.jenisSerahTerima;
    document.getElementById("pv-tabel").textContent =
      data.mapping.tabel === "tabel_dinas_tutup" ? "Tabel Dinas Tutup" : "Tabel Dinas Buka";

    document.getElementById("pv-labelFoto1").textContent =
      `Foto ${data.mapping.kolomFotoSerahTerima}`;

    document.getElementById("pv-fotoSerahTerima").src = photos.fotoSerahTerima.dataUrl;
    document.getElementById("pv-fotoDokumentasi").src = photos.fotoDokumentasi.dataUrl;

    document.getElementById("previewOverlay").classList.add("is-open");
    document.getElementById("previewOverlay").setAttribute("aria-hidden", "false");
  },

  close() {
    document.getElementById("previewOverlay").classList.remove("is-open");
    document.getElementById("previewOverlay").setAttribute("aria-hidden", "true");
  },

  _formatTanggal(isoDate) {
    const d = new Date(isoDate + "T00:00:00");
    return d.toLocaleDateString("id-ID", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  },
};
