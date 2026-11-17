"use strict";
(() => {
  const api = window.TaskConnection;
  const status = document.querySelector('#notification-status');
  const enableButton = document.querySelector('#enable-notifications');
  const disableButton = document.querySelector('#disable-notifications');
  const checkButton = document.querySelector('#check-notifications');
  const preferences = globalThis.MinhaListaPushState;
  const dialog = document.querySelector('#notification-dialog');
  document.querySelector('#notification-button').addEventListener('click', () => { dialog.showModal(); if (!busy) enqueue(inspect); });
  document.querySelector('#close-notifications').addEventListener('click', () => dialog.close());
  let config = null;
  let busy = false;
  let previousUser;
  let serial = Promise.resolve();

  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function supported() { return window.isSecureContext && 'Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator; }
  function enqueue(callback) { const next = serial.then(callback); serial = next.catch(() => {}); return next; }
  function message(text) { status.textContent = text; }
  async function localRegistration() { return navigator.serviceWorker.getRegistration('/'); }

  async function disableBinding() {
    if (api.state.desktop || !('serviceWorker' in navigator)) return;
    // Limpa primeiro o vínculo local: o worker não exibe avisos de outra conta.
    const old = await preferences.read();
    await preferences.write({ enabled: false });
    const registration = await localRegistration();
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    if (subscription) {
      try { await subscription.unsubscribe(); } catch { /* Vínculo local já foi desativado. */ }
      try { await api.removePushSubscription(subscription.endpoint, old.user_id); } catch { /* O endpoint expirado será removido pelo serviço. */ }
    }
  }

  async function inspect() {
    config = null;
    enableButton.disabled = true; disableButton.hidden = true;
    checkButton.hidden = false;
    if (api.state.desktop) { message('Para receber avisos, abra a versão online do app neste aparelho.'); checkButton.hidden = true; return; }
    if (api.state.mode !== 'cloud') { message('Entre na conta para configurar os avisos.'); checkButton.hidden = true; return; }
    if (ios() && !standalone()) { message('No iPhone, abra o app instalado na Tela de Início para ativar notificações.'); checkButton.hidden = true; return; }
    if (!supported()) { message('Este navegador não oferece notificações push. No iPhone, é necessário iOS 16.4 ou superior e o app instalado.'); checkButton.hidden = true; return; }
    try {
      const owner = await preferences.read();
      const registration = await localRegistration();
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      const linked = owner.enabled && owner.user_id === api.state.user_id && subscription;
      disableButton.hidden = !linked;
      config = await api.notificationConfig();
      if (!config.ready) { message('O agendamento no Supabase ainda precisa ser ativado. Depois toque em Verificar serviço.'); return; }
      if (Notification.permission === 'denied') { message('As notificações foram bloqueadas. Libere-as nas configurações do aparelho para continuar.'); return; }
      if (linked) {
        const record = await api.findPushSubscription(subscription.endpoint);
        if (record?.id === owner.subscription_id) { message('Ativadas neste aparelho: dez minutos antes e no horário.'); return; }
        await disableBinding();
      }
      enableButton.disabled = false;
      message('Receba avisos dez minutos antes e no horário. Você escolhe se permite neste aparelho.');
    } catch (error) { message(error.message); }
  }

  async function activateWorker() {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
    async function waitFor(worker, target) {
      if (worker.state === target) return;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { worker.removeEventListener('statechange', changed); reject(new Error('Feche e reabra o app para concluir a atualização dos avisos.')); }, 12000);
        function changed() {
          if (worker.state === target) { clearTimeout(timer); worker.removeEventListener('statechange', changed); resolve(); }
          if (worker.state === 'redundant') { clearTimeout(timer); reject(new Error('Não foi possível atualizar os avisos. Reabra o app.')); }
        }
        worker.addEventListener('statechange', changed); changed();
      });
    }
    if (registration.installing) await waitFor(registration.installing, 'installed');
    if (registration.waiting) {
      const waiting = registration.waiting;
      waiting.postMessage({ type: 'ACTIVATE_PUSH_UPDATE' });
      await waitFor(waiting, 'activated');
    }
    await new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(new Error('Feche e reabra o app para atualizar o serviço de notificações.')); }, 5000);
      channel.port1.onmessage = (event) => { clearTimeout(timer); channel.port1.close(); event.data?.pushReady ? resolve() : reject(new Error('Atualize o app antes de ativar os avisos.')); };
      registration.active.postMessage({ type: 'CHECK_PUSH_READY' }, [channel.port2]);
    });
    return registration;
  }

  enableButton.addEventListener('click', async () => {
    if (busy || !config?.ready || !supported() || api.state.mode !== 'cloud') return;
    const user = api.state.user_id;
    const publicKey = config.publicKey;
    // Pedido direto no gesto do usuário, necessário no Safari.
    const permission = Notification.permission === 'granted' ? Promise.resolve('granted') : Notification.requestPermission();
    busy = true; enableButton.disabled = true; checkButton.disabled = true;
    let subscription;
    try {
      if (await permission !== 'granted') { message('Os avisos não foram ativados. Você pode permitir depois nas configurações do aparelho.'); return; }
      await enqueue(async () => {
        if (api.state.user_id !== user) throw new Error('A conta mudou. Ative os avisos novamente.');
        const registration = await activateWorker();
        await disableBinding();
        const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        if (api.state.user_id !== user) throw new Error('A conta mudou. Ative os avisos novamente.');
        const record = await api.savePushSubscription(subscription.toJSON(), user);
        if (api.state.user_id !== user) throw new Error('A conta mudou. Ative os avisos novamente.');
        await preferences.write({ enabled: true, user_id: user, subscription_id: record.id });
      });
      await inspect();
    } catch (error) {
      await preferences.write({ enabled: false }).catch(() => {});
      if (subscription) await subscription.unsubscribe().catch(() => {});
      message(error.message || 'Não foi possível ativar as notificações neste aparelho.');
    } finally { busy = false; checkButton.disabled = false; }
  });
  disableButton.addEventListener('click', async () => {
    if (busy) return;
    busy = true; disableButton.disabled = true;
    try { await enqueue(disableBinding); await inspect(); message('Avisos desativados neste aparelho.'); }
    catch (error) { message(error.message); }
    finally { busy = false; disableButton.disabled = false; }
  });
  checkButton.addEventListener('click', () => { if (!busy) enqueue(inspect); });
  api.beforeAccountChange(() => enqueue(disableBinding));
  api.subscribe((state) => {
    const user = state.mode === 'cloud' ? state.user_id : null;
    if (user === previousUser) return;
    const oldUser = previousUser;
    previousUser = user;
    enqueue(async () => {
      if (oldUser !== undefined) await disableBinding();
      else if (!state.desktop) {
        const owner = await preferences.read();
        if (owner.enabled && owner.user_id !== user) await disableBinding();
      }
      await inspect();
    }).catch((error) => message(error.message));
  });
  api.ready.then((state) => {
    if (previousUser === undefined) { previousUser = state.mode === 'cloud' ? state.user_id : null; enqueue(inspect); }
  }).catch((error) => message(error.message));
})();
