/**
 * pdf.js
 * -----------------------------------------------------------------------
 * Membuat dokumen PDF di browser (jsPDF) berisi MURNI tabel serah terima
 * (tanpa judul/keterangan tambahan di atas maupun di bawah tabel), persis
 * seperti struktur kolom yang didefinisikan di CONFIG.getTableColumns()
 * — kolom & posisi yang sama persis dipakai juga oleh preview.js supaya
 * preview dan hasil PDF selalu identik.
 * -----------------------------------------------------------------------
 */

const PdfBuilder = {
  /**
   * @param {object} data hasil Form.collect()
   * @param {object} photos { fotoSerahTerima: {dataUrl,...}, fotoDokumentasi: {...} }
   * @returns {{blob: Blob, base64: string, fileName: string}}
   */
  build(data, photos) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const marginX = 12;
    const tableW = pageW - marginX * 2;
    const rowHeaderH = 12;
    const rowBodyH = 100; // tinggi baris tetap & wajar — sebelumnya dipaksa mengisi
                          // seluruh sisa halaman, jadi foto & teks terlihat "ditarik"
                          // memanjang ke atas/bawah. Tabel sekarang diposisikan
                          // di tengah halaman secara vertikal.
    const tableTop = (pageH - (rowHeaderH + rowBodyH)) / 2;

    // ---- Struktur kolom (sumber tunggal: CONFIG, sama dengan preview) ----
    const columns = CONFIG.getTableColumns(data.mapping.tabel);
    let x = marginX;
    columns.forEach((c) => {
      c.x = x;
      c.width = tableW * c.w;
      x += c.width;
    });

    // ---- Header tabel ----
    doc.setDrawColor(20, 30, 50);
    doc.setLineWidth(0.3);
    doc.setFillColor(243, 245, 248);
    doc.rect(marginX, tableTop, tableW, rowHeaderH, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    columns.forEach((c) => {
      doc.rect(c.x, tableTop, c.width, rowHeaderH);
      doc.text(c.label, c.x + c.width / 2, tableTop + rowHeaderH / 2 + 1.2, {
        align: "center",
        maxWidth: c.width - 4,
      });
    });

    // ---- Baris body ----
    const bodyTop = tableTop + rowHeaderH;
    columns.forEach((c) => doc.rect(c.x, bodyTop, c.width, rowBodyH));

    const tanggalLabel = this._formatTanggalPanjang(data.tanggal);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    columns.forEach((c) => {
      if (c.key === "hari") {
        doc.text(tanggalLabel, c.x + c.width / 2, bodyTop + rowBodyH / 2, {
          align: "center",
          maxWidth: c.width - 4,
        });
      }
      if (c.key === "kegiatan") {
        doc.text(data.kegiatan || "", c.x + c.width / 2, bodyTop + rowBodyH / 2, {
          align: "center",
          maxWidth: c.width - 4,
        });
      }
    });

    // ---- Tempatkan foto sesuai mapping ----
    const targetKey = CONFIG.getTargetPhotoKey(data.jenisSerahTerima);
    const targetCol = columns.find((c) => c.key === targetKey);
    const dokCol = columns.find((c) => c.key === "dok");

    this._placeImageInCell(doc, photos.fotoSerahTerima, targetCol, bodyTop, rowBodyH);
    this._placeImageInCell(doc, photos.fotoDokumentasi, dokCol, bodyTop, rowBodyH);

    const fileName = CONFIG.buildPdfFileName(data.tanggal, data.dinas);
    const blob = doc.output("blob");
    const base64 = doc.output("datauristring").split(",")[1];

    return { blob, base64, fileName };
  },

  _placeImageInCell(doc, photo, col, bodyTop, rowBodyH) {
    if (!photo || !col) return;
    const pad = 4;
    const maxW = col.width - pad * 2;
    const maxH = rowBodyH - pad * 2;

    // jsPDF butuh format gambar eksplisit; deteksi dari mime type.
    const format = photo.mimeType && photo.mimeType.includes("png") ? "PNG" : "JPEG";

    try {
      // Kompresi "NONE" = kualitas gambar dipertahankan penuh (tidak
      // dikompres ulang oleh jsPDF), supaya saat PDF di-zoom teks di
      // dalam foto tetap tajam, bukan buram.
      doc.addImage(photo.dataUrl, format, col.x + pad, bodyTop + pad, maxW, maxH, undefined, "NONE");
    } catch (e) {
      // Jika gagal (mis. format tak didukung), tampilkan placeholder teks.
      doc.setFontSize(8);
      doc.text("(gambar tidak dapat ditampilkan)", col.x + pad, bodyTop + pad + 6);
    }
  },

  _formatTanggalPanjang(isoDate) {
    const d = new Date(isoDate + "T00:00:00");
    const hariList = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
    const bulanList = [
      "Januari", "Februari", "Maret", "April", "Mei", "Juni",
      "Juli", "Agustus", "September", "Oktober", "November", "Desember",
    ];
    const hari = hariList[d.getDay()];
    const tgl = String(d.getDate()).padStart(2, "0");
    const bulan = bulanList[d.getMonth()];
    const tahun = d.getFullYear();
    return `${hari}, ${tgl} ${bulan} ${tahun}`;
  },
};
