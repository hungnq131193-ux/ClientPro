
window.QRTransferDecode = {
  buffer: {},
  async input(chunk) {
    const id = chunk.transfer_id;
    this.buffer[id] = this.buffer[id] || [];
    this.buffer[id].push(chunk);
    if (this.buffer[id].length === chunk.total) {
      await ensureBackupSecret();
      const full = this.buffer[id]
        .sort((a,b)=>a.index-b.index)
        .map(c=>c.data).join('');
      const payload = JSON.parse(full);
      if (payload.scope === 'customers') {
        await BackupCore.restoreCustomersTransactional(payload.data);
      } else {
        await BackupCore.restoreAllTransactional(payload.data);
      }
      delete this.buffer[id];
      alert('QR restore thành công');
    }
  }
};
