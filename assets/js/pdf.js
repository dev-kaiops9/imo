/**
 * pdf.js
 * -----------------------------------------------------------------------
 * Membuat dokumen PDF di browser (jsPDF) mengikuti layout tabel yang sama
 * dengan tabel_dinas_tutup.html / tabel_dinas_buka.html, lalu menaruh
 * foto ke kolom yang sesuai berdasarkan CONFIG.MAPPING.
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
    const marginX = 12;
    const tableTop = 38;
    const tableW = pageW - marginX * 2;
    const rowHeaderH = 10;
    const rowBodyH = 90;

    // ---- Judul dokumen ----
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("DOKUMEN SERAH TERIMA DINAS", pageW / 2, 14, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    const infoLines = [
      `NIPP        : ${data.nipp}`,
      `Nama        : ${data.nama}`,
      `Jabatan     : ${data.jabatan}      Stasiun: ${data.stasiun}`,
      `Dinas       : ${data.dinas}      Jenis: ${data.jenisSerahTerima}`,
    ];
    infoLines.forEach((line, i) => doc.text(line, marginX, 21 + i * 4.6));

    // ---- Tentukan struktur kolom sesuai tabel ----
    const tanggalLabel = this._formatTanggalPanjang(data.tanggal);
    let columns;
    if (data.mapping.tabel === "tabel_dinas_tutup") {
      columns = [
        { key: "hari", label: "Hari, Tanggal", w: 0.14 },
        { key: "kegiatan", label: "Kegiatan", w: 0.10 },
        { key: "awal", label: "Awal Dinas", w: 0.22 },
        { key: "akhir", label: "Akhir Dinas", w: 0.22 },
        { key: "dok", label: "Dokumentasi Kegiatan", w: 0.32 },
      ];
    } else {
      columns = [
        { key: "hari", label: "Hari, Tanggal", w: 0.16 },
        { key: "kegiatan", label: "Kegiatan", w: 0.12 },
        { key: "gabung", label: "Serah Terima Dinasan", w: 0.36 },
        { key: "dok", label: "Dokumentasi Kegiatan", w: 0.36 },
      ];
    }

    // Hitung posisi x tiap kolom
    let x = marginX;
    columns.forEach((c) => {
      c.x = x;
      c.width = tableW * c.w;
      x += c.width;
    });

    // ---- Gambar header tabel ----
    doc.setDrawColor(20, 30, 50);
    doc.setLineWidth(0.3);
    doc.setFillColor(243, 245, 248);
    doc.rect(marginX, tableTop, tableW, rowHeaderH, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    columns.forEach((c) => {
      doc.rect(c.x, tableTop, c.width, rowHeaderH);
      doc.text(c.label, c.x + c.width / 2, tableTop + rowHeaderH / 2 + 1.2, {
        align: "center",
        maxWidth: c.width - 4,
      });
    });

    // ---- Gambar baris body ----
    const bodyTop = tableTop + rowHeaderH;
    columns.forEach((c) => doc.rect(c.x, bodyTop, c.width, rowBodyH));

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    columns.forEach((c) => {
      if (c.key === "hari") {
        doc.text(tanggalLabel, c.x + c.width / 2, bodyTop + 8, {
          align: "center",
          maxWidth: c.width - 4,
        });
      }
    });

    // ---- Tempatkan foto sesuai mapping ----
    const targetKeyMap = {
      "Awal Dinas": "awal",
      "Akhir Dinas": "akhir",
      "Serah Terima Dinasan": "gabung",
    };
    const targetKey = targetKeyMap[data.jenisSerahTerima];
    const targetCol = columns.find((c) => c.key === targetKey);
    const dokCol = columns.find((c) => c.key === "dok");

    this._placeImageInCell(doc, photos.fotoSerahTerima, targetCol, bodyTop, rowBodyH);
    this._placeImageInCell(doc, photos.fotoDokumentasi, dokCol, bodyTop, rowBodyH);

    // ---- Footer ----
    doc.setFontSize(8);
    doc.setTextColor(110, 120, 135);
    doc.text(
      `Dibuat otomatis oleh Sistem Serah Terima Dinas — ${new Date().toLocaleString("id-ID")}`,
      marginX,
      bodyTop + rowBodyH + 8
    );

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
      doc.addImage(photo.dataUrl, format, col.x + pad, bodyTop + pad, maxW, maxH, undefined, "MEDIUM");
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
    return `${hari},\n${tgl} ${bulan} ${tahun}`;
  },
};
