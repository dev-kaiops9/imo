/**
 * preview.js
 * -----------------------------------------------------------------------
 * Menampilkan overlay preview PERSIS seperti hasil akhir PDF: satu tabel
 * dengan kolom & posisi yang sama (struktur diambil dari
 * CONFIG.getTableColumns(), sumber tunggal yang sama dipakai pdf.js) —
 * tanpa info tambahan seperti "Tabel Digunakan" / "Tutup" yang memang
 * tidak pernah ada di PDF-nya.
 *
 * Preview ini HANYA menampilkan data (tidak mengirim apa pun ke server).
 * Penyimpanan permanen baru terjadi saat tombol "Simpan" di overlay ini
 * ditekan — dieksekusi oleh main.js (wirePreviewAndSave).
 * -----------------------------------------------------------------------
 */

const Preview = {
  open(data, photos) {
    const columns = CONFIG.getTableColumns(data.mapping.tabel);
    const targetKey = CONFIG.getTargetPhotoKey(data.jenisSerahTerima);
    const tanggalLabel = this._formatTanggalPanjang(data.tanggal);

    const photoByKey = {
      [targetKey]: photos.fotoSerahTerima,
      dok: photos.fotoDokumentasi,
    };

    const wrap = document.getElementById("pvTableWrap");
    wrap.innerHTML = "";
    wrap.appendChild(this._buildTable(columns, data.kegiatan, tanggalLabel, photoByKey));

    document.getElementById("previewOverlay").classList.add("is-open");
    document.getElementById("previewOverlay").setAttribute("aria-hidden", "false");
  },

  close() {
    document.getElementById("previewOverlay").classList.remove("is-open");
    document.getElementById("previewOverlay").setAttribute("aria-hidden", "true");
  },

  _buildTable(columns, kegiatan, tanggalLabel, photoByKey) {
    const table = document.createElement("table");
    table.className = "pv-table";

    const colgroup = document.createElement("colgroup");
    columns.forEach((c) => {
      const col = document.createElement("col");
      col.style.width = `${c.w * 100}%`;
      colgroup.appendChild(col);
    });
    table.appendChild(colgroup);

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    columns.forEach((c) => {
      const th = document.createElement("th");
      th.textContent = c.label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    const bodyRow = document.createElement("tr");
    columns.forEach((c) => {
      const td = document.createElement("td");
      if (c.key === "hari") {
        td.textContent = tanggalLabel;
      } else if (c.key === "kegiatan") {
        td.textContent = kegiatan || "";
      } else if (photoByKey[c.key]) {
        const img = document.createElement("img");
        img.src = photoByKey[c.key].dataUrl;
        img.alt = c.label;
        td.className = "pv-table__photo-cell";
        td.appendChild(img);
      }
      bodyRow.appendChild(td);
    });
    tbody.appendChild(bodyRow);
    table.appendChild(tbody);

    return table;
  },

  _formatTanggalPanjang(isoDate) {
    const d = new Date(isoDate + "T00:00:00");
    return d.toLocaleDateString("id-ID", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  },
};
