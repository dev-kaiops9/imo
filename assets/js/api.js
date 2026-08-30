/**
 * api.js
 * -----------------------------------------------------------------------
 * Semua komunikasi ke backend Google Apps Script lewat di sini.
 * Apps Script Web App hanya mengenal query string (GET) atau body teks
 * biasa (POST) — dikirim sebagai text/plain agar browser tidak melakukan
 * CORS preflight (Apps Script tidak bisa membalas preflight OPTIONS).
 * -----------------------------------------------------------------------
 */

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
   * Kirim seluruh data serah terima (form + foto base64 + pdf base64).
   * @param {object} payload
   */
  async simpanData(payload) {
    const json = await this._post({ action: "simpanData", payload });
    return json.data;
  },
};
