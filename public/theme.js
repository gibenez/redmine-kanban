// Apply before styles paint; system mode stays CSS-driven and reacts to OS changes.
(() => {
  const key = 'redmine-sprint-board.theme';
  let theme = 'system';
  try {
    const saved = localStorage.getItem(key);
    if (['light', 'dark'].includes(saved)) theme = saved;
  } catch { /* Theme selection also works when storage is unavailable. */ }
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.colorScheme = theme === 'system' ? (system.matches ? 'dark' : 'light') : theme;
  };
  apply();
  system.addEventListener('change', apply);
  document.addEventListener('DOMContentLoaded', () => {
    const select = document.getElementById('theme');
    select.value = theme;
    select.addEventListener('change', () => {
      theme = select.value;
      apply();
      try {
        if (select.value === 'system') localStorage.removeItem(key);
        else localStorage.setItem(key, select.value);
      } catch { /* Optional browser preference. */ }
    });
  });
})();
