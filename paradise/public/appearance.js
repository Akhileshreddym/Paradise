// Apply the saved appearance before first paint. Dark unless this browser chose light; one key, read and written: paradise.appearance.v2.
(() => {
  const root = document.documentElement;
  try { root.dataset.theme = localStorage.getItem('paradise.appearance.v2') === 'light' ? 'light' : 'dark'; }
  catch { root.dataset.theme = 'dark'; }
  document.addEventListener('keydown', () => { root.dataset.keyboard = ''; });
  document.addEventListener('pointerdown', () => { delete root.dataset.keyboard; });
  document.addEventListener('DOMContentLoaded', () => {
    const sync = () => document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.setAttribute('aria-label', `Switch to ${root.dataset.theme === 'dark' ? 'light' : 'dark'} appearance`);
      button.setAttribute('aria-pressed', String(root.dataset.theme === 'dark'));
    });
    document.querySelectorAll('[data-theme-toggle]').forEach(button => button.addEventListener('click', () => {
      root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('paradise.appearance.v2', root.dataset.theme); } catch {}
      sync();
    }));
    window.addEventListener('storage', event => {
      if (event.key !== 'paradise.appearance.v2') return;
      root.dataset.theme = event.newValue === 'light' ? 'light' : 'dark';
      sync();
    });
    sync();
    const dialog = document.getElementById('setupDialog');
    document.querySelectorAll('[data-open-setup]').forEach(button => button.addEventListener('click', () => dialog?.showModal()));
    document.querySelector('[data-close-setup]')?.addEventListener('click', () => dialog.close());
    dialog?.addEventListener('click', event => {
      const box = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) dialog.close();
    });
    document.querySelectorAll('[data-open-section]').forEach(link => link.addEventListener('click', () => {
      const section = document.getElementById(link.dataset.openSection);
      if (section) section.open = true;
    }));
  });
})();
