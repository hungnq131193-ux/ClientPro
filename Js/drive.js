function saveScriptUrl() {
    const url = getEl('user-script-url').value.trim();
    if (!url.startsWith('https://script.google.com/')) {
        alert("Link không đúng định dạng!");
        return;
    }
    // Lưu link Script cá nhân vào localStorage với key mới
    localStorage.setItem(USER_SCRIPT_KEY, url);
    showToast("Đã lưu kết nối Drive cá nhân");
}
function renderDriveStatus(url) {
    const area = getEl('drive-status-area');
    const btnUp = getEl('btn-upload-drive');
    
    if (!area) return;
    
    if (url && url.length > 5) {
        // ĐÃ CÓ LINK → hiện nút Mở Drive
        area.classList.remove('hidden');
        area.innerHTML = `
      <a href="${url}" target="_blank"
         class="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold
                flex items-center justify-center gap-2 shadow-lg mb-1
                animate-fade-in border border-emerald-400/30">
        <i data-lucide="external-link" class="w-5 h-5"></i> Mở Folder Ảnh
      </a>
      <p class="text-[10px] text-center text-emerald-400/70 italic mb-2">
        Đã đồng bộ lên Cloud
      </p>
    `;
        
        if (btnUp) btnUp.classList.remove('hidden'); // vẫn cho phép upload thêm
    } else {
        // CHƯA CÓ LINK → hiện nút tìm lại + nút upload
        area.classList.remove('hidden');
        area.innerHTML = `
      <button onclick="reconnectDriveFolder()"
              class="w-full py-2 mb-2 bg-slate-700/50 border border-slate-600
                     rounded-lg text-xs font-medium text-slate-300
                     flex items-center justify-center gap-2 hover:bg-slate-700 transition">
        <i data-lucide="search" class="w-4 h-4"></i> Tìm kết nối cũ
      </button>
    `;
        if (btnUp) btnUp.classList.remove('hidden');
    }
    
    if (window.lucide) lucide.createIcons();
}
function renderAssetDriveStatus(url) {
    const area = getEl('asset-drive-status-area');
    const btnUp = getEl('btn-asset-upload');
    if (!area) return;
    area.classList.remove('hidden');

    if (url && url.length > 5) {
        // Đã có link -> Hiện nút mở
        area.innerHTML = `
            <a href="${url}" target="_blank" class="w-full py-3 bg-teal-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg mb-1 animate-fade-in border border-teal-400/30">
                <i data-lucide="external-link" class="w-5 h-5"></i> Xem Folder TSBĐ
            </a>`;
        if (btnUp) btnUp.classList.remove('hidden');
    } else {
        // Chưa có link -> Hiện nút TÌM LẠI
        area.innerHTML = `
            <button onclick="reconnectAssetDriveFolder()" class="w-full py-2 mb-2 bg-slate-700/50 border border-slate-600 rounded-lg text-xs font-medium text-slate-300 flex items-center justify-center gap-2 hover:bg-slate-700 transition">
                <i data-lucide="search" class="w-4 h-4"></i> Tìm kết nối cũ
            </button>`;
        if (btnUp) btnUp.classList.remove('hidden');
    }
    if(window.lucide) lucide.createIcons();
}