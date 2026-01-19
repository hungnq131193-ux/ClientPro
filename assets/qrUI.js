
window.openQrTransferBackup = async function () {
  const scope = document.querySelector('#qrScope')?.value || 'all';
  let customerIds = [];
  if (scope === 'customers') {
    customerIds = await UISelectCustomers.pickIds();
    if (!customerIds.length) return alert('Chưa chọn khách hàng');
  }
  const chunks = await QRTransferEncode.create({ scope, customerIds });
  const box = document.getElementById('qrBox');
  box.innerHTML = '';
  chunks.forEach(c => {
    const div = document.createElement('div');
    new QRCode(div, JSON.stringify(c));
    box.appendChild(div);
  });
};

window.handleQrImageUpload = async function (files) {
  for (const f of files) {
    const txt = await QRImageDecoder.decode(f);
    await QRTransferDecode.input(JSON.parse(txt));
  }
};
