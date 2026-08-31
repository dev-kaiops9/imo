/**
 * preview.js
 * -----------------------------------------------------------------------
 * PLACEHOLDER SEMENTARA — file asli tidak berhasil dipulihkan dari backup.
 * Menyusun tabel preview (persis struktur PDF akhir, lihat CONFIG.getTableColumns)
 * dari data yang sudah diisi + foto yang sudah diunggah, murni di sisi klien.
 * -----------------------------------------------------------------------
 */

const Preview = {
  render() {
    const data = Form.collect();
    const cols = CONFIG.getTableColumns(data.mapping.tabel, CONFIG.getTargetPhotoKey(data.jenisSerahTerima));
    const wrap = document.getElementById("pvTableWrap");

    const targetKey = CONFIG.getTargetPhotoKey(data.jenisSerahTerima);
    const cellValue = {
      hari: data.tanggal
        ? new Date(data.tanggal + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })
        : "-",
      kegiatan: data.kegiatan || "-",
      dok: UploadField.state.fotoDokumentasi ? URL.createObjectURL(UploadField.state.fotoDokumentasi) : null,
      [targetKey]: UploadField.state.fotoSerahTerima ? URL.createObjectURL(UploadField.state.fotoSerahTerima) : null,
    };

    const headerHtml = cols.map((c) => `<th style="width:${(c.w * 100).toFixed(1)}%">${c.label}</th>`).join("");
    const cellHtml = cols.map((c) => {
      const v = cellValue[c.key];
      if (c.key === "dok" || c.key === targetKey) {
        return `<td>${v ? `<img src="${v}" alt="${c.label}" style="width:100%;border-radius:8px;" />` : "—"}</td>`;
      }
      return `<td>${v || "—"}</td>`;
    }).join("");

    wrap.innerHTML = `
      <table class="preview-table" style="width:100%;border-collapse:collapse;font-size:12.5px;">
        <thead><tr>${headerHtml}</tr></thead>
        <tbody><tr>${cellHtml}</tr></tbody>
      </table>
      <div style="margin-top:14px;font-family:var(--font-mono);font-size:11px;color:var(--ink-600);">
        NIPP ${data.nipp} · ${data.nama} · ${data.jabatan} · ${data.stasiun}
      </div>
    `;
  },
};
