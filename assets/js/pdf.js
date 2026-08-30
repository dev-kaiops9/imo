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
   * @returns {Promise<{blob: Blob, base64: string, fileName: string}>}
   */
  async build(data, photos) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const marginX = 12;
    const marginY = 15;
    const tableTop = marginY;
    const tableW = pageW - marginX * 2;
    const rowHeaderH = 12;
    const rowBodyH = pageH - marginY * 2 - rowHeaderH;

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

    // ---- Tempatkan foto sesuai mapping (crop "cover" — isi penuh kotak) ----
    const targetKey = CONFIG.getTargetPhotoKey(data.jenisSerahTerima);
    const targetCol = columns.find((c) => c.key === targetKey);
    const dokCol = columns.find((c) => c.key === "dok");

    await this._placeImageInCell(doc, photos.fotoSerahTerima, targetCol, bodyTop, rowBodyH);
    await this._placeImageInCell(doc, photos.fotoDokumentasi, dokCol, bodyTop, rowBodyH);

    const fileName = CONFIG.buildPdfFileName(data.tanggal, data.dinas);
    const blob = doc.output("blob");
    const base64 = doc.output("datauristring").split(",")[1];

    return { blob, base64, fileName };
  },

  /**
   * Menaruh foto ke dalam sel tabel dengan prinsip "cover": foto di-crop
   * (bukan diregangkan) supaya area kotak foto terisi penuh tanpa sisa
   * ruang kosong, sama seperti object-fit:cover pada preview di layar.
   */
  async _placeImageInCell(doc, photo, col, bodyTop, rowBodyH) {
    if (!photo || !col) return;
    const pad = 3;
    const maxW = col.width - pad * 2;
    const maxH = rowBodyH - pad * 2;

    try {
      const cropped = await this._cropToCover(photo.dataUrl, maxW, maxH);
      doc.addImage(cropped, "JPEG", col.x + pad, bodyTop + pad, maxW, maxH, undefined, "MEDIUM");
    } catch (e) {
      doc.setFontSize(8);
      doc.text("(gambar tidak dapat ditampilkan)", col.x + pad, bodyTop + pad + 6);
    }
  },

  /**
   * Crop gambar (dataURL) supaya rasio-nya sama dengan targetW/targetH
   * (mm) lalu render ke canvas dengan resolusi cetak yang layak.
   * Ini adalah versi "object-fit: cover": bagian tengah gambar
   * dipertahankan, sisi yang berlebih dipotong — bukan diregangkan.
   */
  _cropToCover(dataUrl, targetWmm, targetHmm) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const targetRatio = targetWmm / targetHmm;
        const srcRatio = img.naturalWidth / img.naturalHeight;

        let sx, sy, sw, sh;
        if (srcRatio > targetRatio) {
          // Gambar sumber lebih lebar dari target -> potong kiri & kanan.
          sh = img.naturalHeight;
          sw = sh * targetRatio;
          sy = 0;
          sx = (img.naturalWidth - sw) / 2;
        } else {
          // Gambar sumber lebih tinggi dari target -> potong atas & bawah.
          sw = img.naturalWidth;
          sh = sw / targetRatio;
          sx = 0;
          sy = (img.naturalHeight - sh) / 2;
        }

        const pxPerMm = 6; // resolusi cukup tajam untuk cetak A4
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(targetWmm * pxPerMm));
        canvas.height = Math.max(1, Math.round(targetHmm * pxPerMm));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.92));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
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
