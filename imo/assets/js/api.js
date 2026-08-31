/**
 * api.js
 * -----------------------------------------------------------------------
 * PLACEHOLDER SEMENTARA — file asli tidak berhasil dipulihkan dari backup.
 * Saat ini semua pemanggilan API di-stub (tidak benar-benar mengirim data)
 * supaya UI bisa dicoba. Saat siap, sambungkan fetch() di bawah ini ke
 * CONFIG.APPS_SCRIPT_URL (lihat config.js).
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
  // TODO: ganti stub ini dengan fetch ke CONFIG.APPS_SCRIPT_URL saat backend disambungkan kembali.
  async cekNipp(nipp) {
    await new Promise((r) => setTimeout(r, 400));
    return { found: false, data: null };
  },

  async saveSerahTerima(payload) {
    await new Promise((r) => setTimeout(r, 900));
    console.log("[stub] saveSerahTerima payload:", payload);
    return { ok: true, fileUrl: null };
  },

  async cariPdf(nipp) {
    await new Promise((r) => setTimeout(r, 500));
    return { found: false, items: [] };
  },
};
