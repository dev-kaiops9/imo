pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const fileInput = document.getElementById('fileInput');
const drop = document.getElementById('drop');
const filenameEl = document.getElementById('filename');
const statusPill = document.getElementById('statusPill');
const statusLabel = document.getElementById('statusLabel');
const statusMsg = document.getElementById('statusMsg');
const previewArea = document.getElementById('previewArea');
const previewEmpty = document.getElementById('previewEmpty');
const canvas = document.getElementById('canvas');
const metaTable = document.getElementById('metaTable');
const downloadBtn = document.getElementById('downloadBtn');
const dpiOptions = document.getElementById('dpiOptions');
const dpiBadge = document.getElementById('dpiBadge');

let currentFile = null;
let resultBlobUrl = null;
let selectedDpi = 300;

dpiOptions.addEventListener('click', (e)=>{
  const card = e.target.closest('.option-card');
  if(!card) return;
  [...dpiOptions.children].forEach(c => c.classList.remove('active'));
  card.classList.add('active');
  selectedDpi = parseInt(card.dataset.dpi, 10);
  dpiBadge.textContent = selectedDpi + ' DPI';
  if(currentFile) processFile(currentFile);
});

function setPill(stage){
  statusPill.classList.remove('processing','done','error');
  if(stage === 'idle'){ statusLabel.textContent = 'Menunggu berkas'; }
  if(stage === 'loaded'){ statusLabel.textContent = 'Berkas diterima'; statusPill.classList.add('processing'); }
  if(stage === 'processing'){ statusLabel.textContent = 'Memproses'; statusPill.classList.add('processing'); }
  if(stage === 'done'){ statusLabel.textContent = 'Selesai'; statusPill.classList.add('done'); }
  if(stage === 'error'){ statusLabel.textContent = 'Gagal'; statusPill.classList.add('error'); }
}

function setStatus(msg, isError){
  statusMsg.textContent = msg || '';
  statusMsg.classList.toggle('err', !!isError);
}

['dragenter','dragover'].forEach(evt=>{
  drop.addEventListener(evt, e=>{ e.preventDefault(); drop.classList.add('drag'); });
});
['dragleave','drop'].forEach(evt=>{
  drop.addEventListener(evt, e=>{ e.preventDefault(); drop.classList.remove('drag'); });
});
drop.addEventListener('drop', e=>{
  const f = e.dataTransfer.files[0];
  if(f) handleFile(f);
});
fileInput.addEventListener('change', e=>{
  const f = e.target.files[0];
  if(f) handleFile(f);
});

function handleFile(file){
  if(file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')){
    setStatus('Berkas harus berformat PDF.', true);
    setPill('error');
    return;
  }
  currentFile = file;
  filenameEl.textContent = file.name;
  setPill('loaded');
  processFile(file);
}

async function processFile(file){
  downloadBtn.disabled = true;
  canvas.classList.remove('show');
  previewEmpty.style.display = 'block';
  metaTable.innerHTML = '';
  setPill('processing');
  setStatus('Membaca berkas PDF…');

  try{
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    if(pdf.numPages !== 2){
      setStatus('PDF ini punya ' + pdf.numPages + ' halaman. Alat ini butuh tepat 2 halaman.', true);
      setPill('error');
      return;
    }

    const dpi = selectedDpi;
    const scale = dpi / 72;

    setStatus('Merender halaman 1…');
    const page1 = await pdf.getPage(1);
    const canvas1 = renderCanvasForPage(page1, scale);
    await drawPageToCanvas(page1, canvas1, scale);

    setStatus('Merender halaman 2…');
    const page2 = await pdf.getPage(2);
    const canvas2 = renderCanvasForPage(page2, scale);
    await drawPageToCanvas(page2, canvas2, scale);

    setStatus('Memangkas spasi kosong…');
    const trimmed1 = cropCanvas(canvas1, detectContentBounds(canvas1));
    const trimmed2 = cropCanvas(canvas2, detectContentBounds(canvas2));

    setStatus('Menyusun ke lembar A4…');
    const finalCanvas = composeOntoA4(trimmed1, trimmed2, dpi);

    canvas.width = finalCanvas.width;
    canvas.height = finalCanvas.height;
    canvas.getContext('2d').drawImage(finalCanvas, 0, 0);
    canvas.classList.add('show');
    previewEmpty.style.display = 'none';

    const mmW = finalCanvas.width / dpi * 25.4;
    const mmH = finalCanvas.height / dpi * 25.4;
    const orientation = finalCanvas.width > finalCanvas.height ? 'A4 Lanskap' : 'A4 Potret';
    metaTable.innerHTML =
      metaRow('Orientasi', orientation) +
      metaRow('Dimensi Piksel', finalCanvas.width + ' × ' + finalCanvas.height + ' px') +
      metaRow('Ukuran Cetak', mmW.toFixed(0) + ' × ' + mmH.toFixed(0) + ' mm') +
      metaRow('Resolusi', dpi + ' DPI');

    finalCanvas.toBlob(blob=>{
      if(resultBlobUrl) URL.revokeObjectURL(resultBlobUrl);
      resultBlobUrl = URL.createObjectURL(blob);
      downloadBtn.disabled = false;
    }, 'image/jpeg', 0.95);

    setStatus('Siap diunduh.');
    setPill('done');
  }catch(err){
    console.error(err);
    setStatus('Gagal memproses PDF: ' + err.message, true);
    setPill('error');
  }
}

function metaRow(label, value){
  return '<div class="meta-row"><span class="meta-label">' + label + '</span><span class="meta-value">' + value + '</span></div>';
}

function renderCanvasForPage(page, scale){
  const viewport = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.ceil(viewport.width);
  c.height = Math.ceil(viewport.height);
  return c;
}

async function drawPageToCanvas(page, c, scale){
  const viewport = page.getViewport({ scale });
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
}

function detectContentBounds(canvas){
  const maxDim = 800;
  const scale = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
  const tmp = document.createElement('canvas');
  tmp.width = Math.max(1, Math.round(canvas.width * scale));
  tmp.height = Math.max(1, Math.round(canvas.height * scale));
  const tctx = tmp.getContext('2d');
  tctx.drawImage(canvas, 0, 0, tmp.width, tmp.height);
  const data = tctx.getImageData(0, 0, tmp.width, tmp.height).data;

  const threshold = 248;
  let minX = tmp.width, minY = tmp.height, maxX = -1, maxY = -1;
  for(let y = 0; y < tmp.height; y++){
    for(let x = 0; x < tmp.width; x++){
      const idx = (y * tmp.width + x) * 4;
      const r = data[idx], g = data[idx+1], b = data[idx+2], a = data[idx+3];
      if(a > 10 && (r < threshold || g < threshold || b < threshold)){
        if(x < minX) minX = x;
        if(x > maxX) maxX = x;
        if(y < minY) minY = y;
        if(y > maxY) maxY = y;
      }
    }
  }

  if(maxX < minX || maxY < minY){
    return { x: 0, y: 0, width: canvas.width, height: canvas.height };
  }

  const invScale = 1 / scale;
  let x = Math.floor(minX * invScale);
  let y = Math.floor(minY * invScale);
  let w = Math.ceil((maxX - minX + 1) * invScale);
  let h = Math.ceil((maxY - minY + 1) * invScale);

  const padX = Math.round(canvas.width * 0.012);
  const padY = Math.round(canvas.height * 0.012);
  x = Math.max(0, x - padX);
  y = Math.max(0, y - padY);
  w = Math.min(canvas.width - x, w + padX * 2);
  h = Math.min(canvas.height - y, h + padY * 2);

  return { x, y, width: w, height: h };
}

function cropCanvas(canvas, bounds){
  const c = document.createElement('canvas');
  c.width = bounds.width;
  c.height = bounds.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(canvas, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
  return c;
}

function composeOntoA4(canvas1, canvas2, dpi){
  const stackWidth = Math.max(canvas1.width, canvas2.width);
  const dividerGap = Math.round(dpi * 0.04);
  const stackHeight = canvas1.height + canvas2.height + dividerGap;

  const stack = document.createElement('canvas');
  stack.width = stackWidth;
  stack.height = stackHeight;
  const sctx = stack.getContext('2d');
  sctx.fillStyle = '#FFFFFF';
  sctx.fillRect(0, 0, stackWidth, stackHeight);
  sctx.drawImage(canvas1, (stackWidth - canvas1.width) / 2, 0);
  sctx.drawImage(canvas2, (stackWidth - canvas2.width) / 2, canvas1.height + dividerGap);

  const A4_MM = { w: 210, h: 297 };
  const isPortrait = stackHeight >= stackWidth;
  const a4wmm = isPortrait ? A4_MM.w : A4_MM.h;
  const a4hmm = isPortrait ? A4_MM.h : A4_MM.w;
  const a4w = Math.round(a4wmm / 25.4 * dpi);
  const a4h = Math.round(a4hmm / 25.4 * dpi);

  const availW = a4w;
  const availH = a4h;

  const fitScale = Math.min(availW / stackWidth, availH / stackHeight);
  const drawW = stackWidth * fitScale;
  const drawH = stackHeight * fitScale;
  const offsetX = (a4w - drawW) / 2;
  const offsetY = (a4h - drawH) / 2;

  const final = document.createElement('canvas');
  final.width = a4w;
  final.height = a4h;
  const fctx = final.getContext('2d');
  fctx.fillStyle = '#FFFFFF';
  fctx.fillRect(0, 0, a4w, a4h);
  fctx.imageSmoothingEnabled = true;
  fctx.imageSmoothingQuality = 'high';
  fctx.drawImage(stack, 0, 0, stackWidth, stackHeight, offsetX, offsetY, drawW, drawH);

  return final;
}

// Ganti URL di bawah ini dengan URL hasil "Deploy > Web app" dari Apps Script Anda.
// Contoh: https://script.google.com/macros/s/AKfycbXXXXXXXXXXXXXXXXXXXXXX/exec
const COUNTER_URL = 'https://script.google.com/macros/s/AKfycby0AVNrofzwUTcT6eTPCSnSOPiVnHBmtJgkqgSWC8XYe7GyO5vZg5kWU4mi5ncdhAd8Ug/exec';

function recordUsage(){
  if(!COUNTER_URL || COUNTER_URL.indexOf('GANTI_DENGAN') === 0){
    console.warn('COUNTER_URL belum diisi — pencatatan penggunaan dilewati.');
    return;
  }
  // no-cors: kirim saja tanpa menunggu/memakai isi balasannya, supaya tidak
  // terhalang kebijakan CORS Apps Script dan tidak memblokir proses unduh.
  fetch(COUNTER_URL, { method: 'POST', mode: 'no-cors' }).catch(()=>{
    // Diamkan errornya — pencatatan gagal tidak boleh mengganggu proses unduh.
  });
}

downloadBtn.addEventListener('click', ()=>{
  if(!resultBlobUrl) return;
  const a = document.createElement('a');
  const baseName = currentFile ? currentFile.name.replace(/\.pdf$/i, '') : 'dokumen';
  a.href = resultBlobUrl;
  a.download = baseName + '-A4.jpg';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  recordUsage();
});

setPill('idle');
