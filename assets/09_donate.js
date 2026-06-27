// =============== DONATE FEATURE ===============

function buildDonateQRUrl() {
  // Theo Quick Link VietQR: https://img.vietqr.io/image/<BANK_ID>-<ACCOUNT_NO>-<TEMPLATE>.jpg?accountName=...&addInfo=... 1
  const base = `https://img.vietqr.io/image/${DONATE_BANK_ID}-${DONATE_ACCOUNT_NO}-compact2.jpg`;
  const params = new URLSearchParams({
    accountName: DONATE_ACCOUNT_NAME,
    addInfo: DONATE_DEFAULT_DESC,
  });
  return `${base}?${params.toString()}`;
}

function openDonateModal() {
  const modal = getEl("donate-modal");
  const img = getEl("donate-qr-img");
  if (img && !img.src) {
    img.src = buildDonateQRUrl(); // tạo QR VietQR “xịn” đúng STK + tên
  }
  modal.classList.remove("hidden");
}

function closeDonateModal() {
  const modal = getEl("donate-modal");
  if (modal) modal.classList.add("hidden");
}

function copyDonateAccount() {
  const acc = DONATE_ACCOUNT_NO;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(acc)
      .then(() => {
        showToast("Đã copy số tài khoản VietinBank");
      })
      .catch(() => {
        fallbackCopyDonate(acc);
      });
  } else {
    fallbackCopyDonate(acc);
  }
}

function fallbackCopyDonate(text) {
  const input = document.createElement("input");
  input.value = text;
  document.body.appendChild(input);
  input.select();
  try {
    document.execCommand("copy");
    showToast("Đã copy số tài khoản");
  } catch (e) {
    alert("Không copy được, vui lòng nhập tay STK: " + text);
  }
  document.body.removeChild(input);
}

// =========== END DONATE FEATURE ===========
