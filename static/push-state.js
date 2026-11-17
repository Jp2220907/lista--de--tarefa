"use strict";
globalThis.MinhaListaPushState = (() => {
  let opening;
  function database() {
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = indexedDB.open('minha-lista-device', 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('settings'); };
      request.onerror = () => { opening = null; reject(new Error('Não foi possível guardar a preferência de notificações neste aparelho.')); };
      request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); opening = null; }; resolve(db); };
    });
    return opening;
  }
  async function read() {
    const db = await database();
    return new Promise((resolve, reject) => {
      const request = db.transaction('settings').objectStore('settings').get('push');
      request.onsuccess = () => resolve(request.result || { enabled: false });
      request.onerror = () => reject(new Error('Não foi possível ler a preferência de notificações.'));
    });
  }
  async function write(value) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('settings', 'readwrite');
      transaction.objectStore('settings').put(value, 'push');
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(new Error('Não foi possível atualizar as notificações neste aparelho.'));
    });
  }
  return { read, write };
})();
