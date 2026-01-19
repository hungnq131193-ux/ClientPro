
window.QRTransferCrypto = {
  async encryptAndChunk(payload) {
    const text = JSON.stringify(payload);
    const max = 800;
    const chunks = [];
    let i = 0;
    while (i < text.length) {
      chunks.push({
        transfer_id: payload.createdAt,
        index: chunks.length + 1,
        total: Math.ceil(text.length / max),
        data: text.slice(i, i + max)
      });
      i += max;
    }
    return chunks;
  }
};
