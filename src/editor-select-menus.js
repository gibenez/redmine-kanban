import { projectSwatch } from './project-summary.js';

let nextMenuId = 0;

// Enhance the existing form controls, not a second combobox: native values,
// validation, labels and automation (including selectOption) stay authoritative.
export function createEditorSelectMenus(root, { getColor = () => '' } = {}) {
  const document = root.ownerDocument, window = document.defaultView;
  const records = new Map(), listeners = [];
  const popup = document.createElement('div');
  popup.id = `editor-select-options-${++nextMenuId}`;
  popup.className = 'sprint-filter-options editor-select-options';
  popup.setAttribute('role', 'listbox');
  popup.setAttribute('popover', 'manual');
  popup.hidden = true;
  // Reset the UA popover's centered inset/margin even without extra CSS.
  Object.assign(popup.style, { position: 'fixed', inset: 'auto', margin: '0', boxSizing: 'border-box' });
  root.append(popup);
  let current = null, activeIndex = -1, pointerSelect = null, destroyed = false;
  let search = '', searchTime = 0, positionedBounds = null;
  const attributes = ['aria-expanded', 'aria-controls', 'aria-activedescendant', 'aria-haspopup'];

  function listen(target, type, callback, options) {
    target.addEventListener(type, callback, options);
    listeners.push(() => target.removeEventListener(type, callback, options));
  }
  function usable(select) {
    if (!root.contains(select) || select.multiple || select.size > 1 || select.matches(':disabled')) return false;
    for (let node = select; node; node = node.parentElement) {
      if (node.hidden || (node.tagName === 'DIALOG' && !node.open)) return false;
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    }
    return true;
  }
  function available(option) {
    return option && !option.disabled && !option.hidden && !option.parentElement?.disabled && !option.parentElement?.hidden;
  }
  function indexes() {
    return [...current.options].flatMap((option, index) => available(option) ? [index] : []);
  }
  function name(select) {
    return select.getAttribute('aria-label') || [...(select.labels || [])].map(label => label.textContent.trim()).join(' ') || 'Choose an option';
  }
  function revealActive() {
    if (!current || popup.hidden || !popup.clientHeight) return;
    const button = popup.querySelector('.editor-select-option.is-active');
    if (!button) return;
    // scrollIntoView can also scroll the dialog/document. Only move this
    // listbox's scrollport, which is independent of its anchor in the top layer.
    const bounds = button.getBoundingClientRect(), panelBounds = popup.getBoundingClientRect();
    const top = panelBounds.top + popup.clientTop, bottom = top + popup.clientHeight;
    if (bounds.top < top) popup.scrollTop += bounds.top - top;
    else if (bounds.bottom > bottom) popup.scrollTop += bounds.bottom - bottom;
  }
  function setActive(index, reveal = true) {
    activeIndex = index;
    for (const button of popup.querySelectorAll('[role="option"]')) {
      const active = Number(button.dataset.index) === index;
      button.classList.toggle('is-active', active);
      if (active) {
        current.setAttribute('aria-activedescendant', button.id);
      }
    }
    if (index < 0) current.removeAttribute('aria-activedescendant');
    if (reveal) revealActive();
  }
  function render() {
    popup.setAttribute('aria-label', name(current));
    const options = [...current.options].flatMap((option, index) => {
      if (option.hidden || option.parentElement?.hidden) return [];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'editor-select-option';
      button.id = `${popup.id}-option-${index}`;
      button.dataset.index = String(index);
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(option.selected));
      button.disabled = !available(option);
      button.setAttribute('aria-disabled', String(button.disabled));
      button.tabIndex = -1;
      if (current.id === 'creation-project') button.append(projectSwatch(getColor(current, option.value)));
      button.append(document.createTextNode(option.label));
      return [button];
    });
    popup.replaceChildren(...options);
    const choices = indexes();
    if (!choices.includes(activeIndex)) activeIndex = choices.includes(current.selectedIndex) ? current.selectedIndex : (choices[0] ?? -1);
    setActive(activeIndex, false);
  }
  function position() {
    if (!current) return;
    if (!usable(current)) { close(); return; }
    const bounds = current.getBoundingClientRect();
    const width = window.innerWidth, height = window.innerHeight, margin = 8, gap = 4;
    if (bounds.bottom < 0 || bounds.top > height || bounds.right < 0 || bounds.left > width) { close(); return; }
    const availableWidth = Math.max(0, width - margin * 2);
    popup.style.minWidth = `${Math.min(availableWidth, Math.max(176, bounds.width || 0))}px`;
    popup.style.maxWidth = `${Math.min(availableWidth, Math.max(320, bounds.width || 0))}px`;
    const below = Math.max(0, height - bounds.bottom - gap - margin);
    const above = Math.max(0, bounds.top - gap - margin);
    const preferred = Math.min(320, height * .45, popup.scrollHeight);
    const flip = below < preferred && above > below;
    popup.style.maxHeight = `${Math.max(0, Math.min(320, height * .45, flip ? above : below))}px`;
    const left = Math.max(margin, Math.min(bounds.left, width - popup.offsetWidth - margin));
    const top = flip ? bounds.top - popup.offsetHeight - gap : bounds.bottom + gap;
    popup.style.left = `${left}px`;
    popup.style.top = `${Math.max(margin, Math.min(top, height - popup.offsetHeight - margin))}px`;
    positionedBounds = { top: bounds.top, right: bounds.right, bottom: bounds.bottom, left: bounds.left };
    // Opening/sync can render while hidden or with stale panel dimensions.
    // Reveal the selected/active option only after final viewport positioning.
    revealActive();
  }
  function close() {
    if (!current) return;
    current.setAttribute('aria-expanded', 'false');
    current.removeAttribute('aria-activedescendant');
    current = null;
    positionedBounds = null;
    activeIndex = -1;
    search = '';
    // Calling hidePopover on a non-open/unsupported element can throw.
    try { popup.hidePopover?.(); } catch { /* hidden is the fallback */ }
    popup.hidden = true;
    popup.removeAttribute('aria-label');
  }
  function open(select) {
    if (!usable(select)) return false;
    if (current === select) return true;
    close();
    current = select;
    activeIndex = select.selectedIndex;
    render();
    popup.hidden = false;
    try { popup.showPopover?.(); } catch { /* ordinary fixed panel in older browsers/jsdom */ }
    select.setAttribute('aria-expanded', 'true');
    select.focus({ preventScroll: true });
    position();
    return current === select;
  }
  function choose(index) {
    if (!current || !usable(current) || !available(current.options[index])) { close(); return; }
    const select = current, changed = select.selectedIndex !== index;
    select.selectedIndex = index;
    close();
    select.focus({ preventScroll: true });
    if (changed) {
      select.dispatchEvent(new window.Event('input', { bubbles: true }));
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    }
    sync();
  }
  function targetSelect(event) {
    return records.has(event.target) ? event.target : null;
  }
  function keydown(event) {
    const select = targetSelect(event);
    if (!select) return;
    pointerSelect = null;
    const { key } = event;
    if (key === 'Escape') {
      if (current) { event.preventDefault(); event.stopPropagation(); close(); }
      return;
    }
    if (key === 'Tab') { close(); return; }
    if (!usable(select) || event.ctrlKey || event.metaKey) return;
    const navigation = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    const activation = key === 'Enter' || key === ' ';
    if (event.altKey && key === 'ArrowDown') { event.preventDefault(); open(select); return; }
    if (event.altKey && key === 'ArrowUp') { event.preventDefault(); close(); return; }
    if (key === 'F4' && !event.altKey) {
      event.preventDefault();
      if (current === select) close(); else open(select);
      return;
    }
    if (event.altKey || (!activation && !navigation.includes(key) && key.length !== 1)) return;
    event.preventDefault();
    if (activation) {
      if (current === select) choose(activeIndex);
      else open(select);
      return;
    }
    const wasOpen = current === select;
    if (!open(select)) return;
    const choices = indexes(), at = choices.indexOf(activeIndex);
    if (key === 'Home') setActive(choices[0] ?? -1);
    else if (key === 'End') setActive(choices.at(-1) ?? -1);
    else if (key === 'ArrowDown' || key === 'ArrowUp') {
      if (wasOpen) setActive(choices[Math.max(0, Math.min(choices.length - 1, at + (key === 'ArrowDown' ? 1 : -1)))] ?? -1);
    } else {
      const now = Date.now();
      search = now - searchTime > 700 ? key : search + key;
      searchTime = now;
      const repeated = [...search].every(character => character.toLocaleLowerCase() === key.toLocaleLowerCase());
      const query = (repeated ? key : search).toLocaleLowerCase();
      const ordered = [...choices.slice(at + 1), ...choices.slice(0, at + 1)];
      const match = ordered.find(index => current.options[index].label.trim().toLocaleLowerCase().startsWith(query));
      if (match !== undefined) setActive(match);
    }
  }
  function restore(select, record) {
    for (const [attribute, value] of record.attributes) {
      if (value === null) select.removeAttribute(attribute);
      else select.setAttribute(attribute, value);
    }
    select.classList.toggle('editor-select', record.editorClass);
    select.classList.toggle('has-project-color', record.colorClass);
    if (record.color) select.style.setProperty('--project-color', record.color);
    else select.style.removeProperty('--project-color');
  }
  function sync() {
    if (destroyed) return;
    for (const [select, record] of records) {
      if (!root.contains(select) || select.multiple || select.size > 1) {
        if (current === select) close();
        restore(select, record); records.delete(select);
      }
    }
    for (const select of root.querySelectorAll('select:not([multiple])')) {
      if (select.size > 1) continue;
      if (!records.has(select)) records.set(select, {
        attributes: attributes.map(attribute => [attribute, select.getAttribute(attribute)]),
        editorClass: select.classList.contains('editor-select'),
        colorClass: select.classList.contains('has-project-color'),
        color: select.style.getPropertyValue('--project-color'),
      });
      select.classList.add('editor-select');
      select.setAttribute('aria-haspopup', 'listbox');
      select.setAttribute('aria-controls', popup.id);
      select.setAttribute('aria-expanded', String(current === select));
      if (current !== select) select.removeAttribute('aria-activedescendant');
      if (select.id === 'creation-project') {
        const color = getColor(select, select.value) || '';
        select.classList.toggle('has-project-color', Boolean(color));
        if (color) select.style.setProperty('--project-color', color);
        else select.style.removeProperty('--project-color');
      }
    }
    if (current) {
      if (!usable(current)) close();
      else { render(); position(); }
    }
  }

  listen(root, 'pointerdown', event => {
    if (event.button > 0 || event.isPrimary === false) return;
    const select = targetSelect(event);
    pointerSelect = select;
    if (select && usable(select)) {
      event.preventDefault();
      if (current === select) close(); else open(select);
    } else if (popup.contains(event.target)) event.preventDefault(); // retain select focus
  });
  // Some engines still deliver compatibility mouse events after pointerdown.
  // Cancel those too, without opening/toggling the panel a second time.
  listen(root, 'mousedown', event => {
    const select = targetSelect(event);
    if (event.button === 0 && select && usable(select)) event.preventDefault();
  });
  listen(root, 'click', event => {
    const select = targetSelect(event);
    if (select) {
      event.preventDefault();
      if (pointerSelect !== select && usable(select)) {
        if (current === select) close(); else open(select);
      }
      pointerSelect = null;
      return;
    }
    const button = event.target.closest?.('[role="option"]');
    if (button && popup.contains(button)) { event.preventDefault(); choose(Number(button.dataset.index)); }
  });
  listen(root, 'keydown', keydown);
  listen(root, 'change', event => { if (targetSelect(event)) { close(); sync(); } });
  listen(root, 'close', close);
  listen(root, 'cancel', event => {
    if (current) { event.preventDefault(); event.stopPropagation(); close(); }
  });
  const outside = event => {
    if (current && event.target !== current && !popup.contains(event.target)) close();
  };
  listen(document, 'pointerdown', outside, true);
  listen(document, 'click', outside, true);
  listen(document, 'focusin', outside);
  listen(document, 'scroll', event => {
    if (!current || popup.contains(event.target)) return;
    // A scrollIntoView before activation (including automation's click) can
    // queue a scroll event delivered after opening. Dismiss only if the anchor
    // actually moved since positioning, not merely because an event arrived.
    const bounds = current.getBoundingClientRect();
    if (!usable(current) || !positionedBounds || Object.keys(positionedBounds).some(key => bounds[key] !== positionedBounds[key])) close();
  }, true);
  listen(window, 'resize', position);
  const observer = new window.MutationObserver(() => { if (current && !usable(current)) close(); });
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'style', 'class', 'open'] });
  sync();
  return {
    sync,
    close,
    destroy() {
      if (destroyed) return;
      close(); destroyed = true;
      observer.disconnect();
      for (const remove of listeners) remove();
      for (const [select, record] of records) restore(select, record);
      records.clear(); popup.remove();
    },
  };
}
