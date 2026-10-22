// Restore before styles paint; System mode reacts to OS changes.
(() => {
  const key = 'redmine-sprint-board.theme';
  let theme = 'system';
  try {
    const saved = localStorage.getItem(key);
    if (['light', 'dark'].includes(saved)) theme = saved;
  } catch { /* Theme selection also works when storage is unavailable. */ }
  const modes = ['system', 'light', 'dark'];
  const labels = { system: 'System', light: 'Light', dark: 'Dark' };
  let button;
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.colorScheme = theme === 'system' ? (system.matches ? 'dark' : 'light') : theme;
    if (button) {
      button.dataset.theme = theme;
      const next = modes[(modes.indexOf(theme) + 1) % modes.length];
      const label = `Appearance: ${labels[theme]}. Switch to ${labels[next]}`;
      button.setAttribute('aria-label', label); button.title = label;
      button.querySelectorAll('[data-theme-icon]').forEach(icon => icon.toggleAttribute('hidden', icon.dataset.themeIcon !== theme));
    }
  };
  apply();
  system.addEventListener('change', apply);
  document.addEventListener('DOMContentLoaded', () => {
    button = document.getElementById('theme');
    apply();
    button.addEventListener('click', () => {
      theme = modes[(modes.indexOf(theme) + 1) % modes.length];
      apply();
      try {
        if (theme === 'system') localStorage.removeItem(key);
        else localStorage.setItem(key, theme);
      } catch { /* Optional browser preference. */ }
    });
  });
})();
