import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorSelectMenus } from '../src/editor-select-menus.js';

let root, select, other, menus;
const panel = () => root.querySelector('.editor-select-options');
const options = () => [...panel().querySelectorAll('[role="option"]')];
const key = (key, extra = {}) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
  select.dispatchEvent(event);
  return event;
};
const pointer = target => {
  const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
  target.dispatchEvent(event);
  return event;
};
const active = () => document.getElementById(select.getAttribute('aria-activedescendant'));

beforeEach(() => {
  document.body.innerHTML = `<dialog open><form>
    <label for="creation-project">Project</label>
    <select id="creation-project" name="project" required>
      <option value="">Choose a project</option>
      <option value="alpha" selected>Alpha</option>
      <option value="beta">Beta</option>
      <option value="bravo">Bravo</option>
      <option value="locked" disabled>Locked</option>
      <optgroup label="Unavailable" disabled><option value="group">Group</option></optgroup>
      <option value="hidden" hidden>Hidden</option>
    </select>
    <label>Priority<select id="priority"><option value="low">Low</option><option value="high">High</option></select></label>
    <button type="button" id="outside">Other control</button>
  </form></dialog><button id="external">Outside dialog</button>`;
  root = document.querySelector('dialog');
  select = root.querySelector('#creation-project');
  other = root.querySelector('#priority');
});
afterEach(() => { menus?.destroy(); menus = null; vi.restoreAllMocks(); });

describe('editor native select enhancement', () => {
  it('preserves the only combobox, its labels, IDs, native options and form validation', () => {
    const nativeOptions = [...select.options], label = select.labels[0];
    menus = createEditorSelectMenus(root);
    expect(root.querySelector('#creation-project')).toBe(select);
    expect([...select.options]).toEqual(nativeOptions);
    expect(select.labels[0]).toBe(label);
    expect(select.hidden).toBe(false);
    expect(select.classList.contains('editor-select')).toBe(true);
    expect(root.querySelectorAll('select, [role="combobox"]')).toHaveLength(2);
    expect(new FormData(root.querySelector('form')).get('project')).toBe('alpha');
    select.value = '';
    expect(select.checkValidity()).toBe(false);
    expect(select.getAttribute('aria-haspopup')).toBe('listbox');
    expect(select.getAttribute('aria-expanded')).toBe('false');
    expect(select.getAttribute('aria-controls')).toBe(panel().id);
    root.open = false;
    expect(() => menus.sync()).not.toThrow();
    expect(select.classList.contains('editor-select')).toBe(true);
    expect(panel().hidden).toBe(true);
  });

  it('intercepts pointer activation without double opening the OS menu or toggling again on click', () => {
    menus = createEditorSelectMenus(root);
    expect(pointer(select).defaultPrevented).toBe(true);
    expect(panel().hidden).toBe(false);
    expect(document.activeElement).toBe(select);
    const mouse = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
    select.dispatchEvent(mouse);
    expect(mouse.defaultPrevented).toBe(true);
    expect(panel().hidden).toBe(false);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    select.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(panel().hidden).toBe(false);
    pointer(select); select.click();
    expect(panel().hidden).toBe(true);
  });

  it('supports synthetic click activation and renders a labeled, single-select listbox inside the dialog', () => {
    menus = createEditorSelectMenus(root);
    select.click();
    expect(panel().parentElement).toBe(root);
    expect(panel().classList.contains('sprint-filter-options')).toBe(true);
    expect(panel().getAttribute('role')).toBe('listbox');
    expect(panel().getAttribute('aria-label')).toBe('Project');
    expect(panel().querySelector('.sprint-filter-heading')).toBeNull();
    expect(panel().firstElementChild.getAttribute('role')).toBe('option');
    expect(options().map(button => button.textContent)).toEqual(['Choose a project', 'Alpha', 'Beta', 'Bravo', 'Locked', 'Group']);
    expect(options().every(button => button.classList.contains('editor-select-option') && button.type === 'button' && button.tabIndex === -1)).toBe(true);
    expect(options().filter(button => button.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    expect(options()[4].disabled).toBe(true);
    expect(options()[5].disabled).toBe(true);
    expect(active()).toBe(options()[1]);
    expect(active().classList.contains('is-active')).toBe(true);
  });

  it('selects one option, emits bubbling native events in order, closes and retains focus', () => {
    menus = createEditorSelectMenus(root);
    const events = [];
    root.addEventListener('input', event => events.push([event.type, event.target, select.value]));
    root.addEventListener('change', event => events.push([event.type, event.target, select.value]));
    select.click();
    pointer(options()[2]); options()[2].click();
    expect(select.value).toBe('beta');
    expect([...select.selectedOptions]).toHaveLength(1);
    expect(events).toEqual([['input', select, 'beta'], ['change', select, 'beta']]);
    expect(document.activeElement).toBe(select);
    expect(panel().hidden).toBe(true);
    expect(select.getAttribute('aria-expanded')).toBe('false');
    expect(select.hasAttribute('aria-activedescendant')).toBe(false);
    select.click();
    expect(options()[2].getAttribute('aria-selected')).toBe('true');
    options()[2].click();
    expect(events).toHaveLength(2); // reselecting the current value is not a change
  });

  it('opens with keyboard, navigates without changing values and commits with Enter or Space', () => {
    menus = createEditorSelectMenus(root);
    select.focus();
    expect(key('ArrowDown').defaultPrevented).toBe(true);
    expect(active().textContent).toBe('Alpha');
    key('ArrowDown');
    expect(active().textContent).toBe('Beta');
    expect(select.value).toBe('alpha');
    key('Enter');
    expect(select.value).toBe('beta');
    key(' '); key('Home');
    expect(active().textContent).toBe('Choose a project');
    key('End');
    expect(active().textContent).toBe('Bravo');
    key('ArrowDown');
    expect(active().textContent).toBe('Bravo');
    key('ArrowUp');
    expect(active().textContent).toBe('Beta');
    key(' ');
    expect(select.value).toBe('beta');
    expect(panel().hidden).toBe(true);
  });

  it('Alt+ArrowDown opens only the custom popup and never commits or toggles it closed', () => {
    menus = createEditorSelectMenus(root);
    select.focus();
    expect(key('ArrowDown', { altKey: true }).defaultPrevented).toBe(true);
    expect(panel().hidden).toBe(false);
    key('End');
    expect(active().textContent).toBe('Bravo');
    expect(key('ArrowDown', { altKey: true }).defaultPrevented).toBe(true);
    expect(panel().hidden).toBe(false);
    expect(active().textContent).toBe('Bravo');
    expect(select.value).toBe('alpha');
    expect(key('ArrowUp', { altKey: true }).defaultPrevented).toBe(true);
    expect(panel().hidden).toBe(true);
    expect(document.activeElement).toBe(select);
    expect(select.value).toBe('alpha');
  });

  it('F4 toggles the custom popup without committing, while Alt+F4 stays native', () => {
    menus = createEditorSelectMenus(root);
    select.focus();
    expect(key('F4').defaultPrevented).toBe(true);
    expect(panel().hidden).toBe(false);
    key('End');
    expect(key('F4').defaultPrevented).toBe(true);
    expect(panel().hidden).toBe(true);
    expect(select.value).toBe('alpha');
    expect(document.activeElement).toBe(select);
    expect(key('F4', { altKey: true }).defaultPrevented).toBe(false);
    expect(panel().hidden).toBe(true);
  });

  it('supports incremental and repeated-character typeahead, resetting after a pause', () => {
    menus = createEditorSelectMenus(root);
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    key('b'); expect(active().textContent).toBe('Beta');
    key('b'); expect(active().textContent).toBe('Bravo');
    now.mockReturnValue(2000);
    key('b'); key('r'); expect(active().textContent).toBe('Bravo');
    now.mockReturnValue(3000);
    key('a'); expect(active().textContent).toBe('Alpha');
    expect(select.value).toBe('alpha');
  });

  it('Escape dismisses only the menu, without committing or bubbling into dialog handlers', () => {
    menus = createEditorSelectMenus(root);
    const escaped = vi.fn();
    document.addEventListener('keydown', escaped);
    key('Enter'); key('ArrowDown');
    escaped.mockClear();
    expect(key('Escape').defaultPrevented).toBe(true);
    expect(escaped).not.toHaveBeenCalled();
    expect(select.value).toBe('alpha');
    expect(root.open).toBe(true);
    expect(document.activeElement).toBe(select);
    expect(key('Escape').defaultPrevented).toBe(false);
    expect(escaped).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', escaped);
  });

  it('Tab dismisses normally; dialog cancel is consumed only when a menu is open', () => {
    menus = createEditorSelectMenus(root);
    key('Enter');
    expect(key('Tab').defaultPrevented).toBe(false);
    expect(panel().hidden).toBe(true);
    key('Enter');
    const cancel = new Event('cancel', { cancelable: true });
    root.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(panel().hidden).toBe(true);
    const second = new Event('cancel', { cancelable: true });
    root.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(false);
  });

  it('allows one open menu, closes outside via pointer/click/focus, and does not steal outside focus', () => {
    menus = createEditorSelectMenus(root);
    select.click(); other.click();
    expect(select.getAttribute('aria-expanded')).toBe('false');
    expect(other.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelectorAll('.editor-select-options')).toHaveLength(1);
    pointer(root.querySelector('#outside'));
    expect(panel().hidden).toBe(true);
    expect(panel().hasAttribute('aria-label')).toBe(false);
    select.click(); document.querySelector('#external').click();
    expect(panel().hidden).toBe(true);
    select.click(); root.querySelector('#outside').focus();
    expect(panel().hidden).toBe(true);
    expect(document.activeElement.id).toBe('outside');
  });

  it('syncs options and values from native selectOption-style updates without replacing the select', () => {
    menus = createEditorSelectMenus(root);
    select.click();
    select.value = 'beta';
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(panel().hidden).toBe(true);
    select.click();
    expect(options()[2].getAttribute('aria-selected')).toBe('true');
    select.innerHTML = '<option value="new">New choice</option><option value="second">Second</option>';
    select.value = 'second';
    menus.sync();
    expect(root.querySelector('#creation-project')).toBe(select);
    expect(options().map(button => button.textContent)).toEqual(['New choice', 'Second']);
    expect(options()[1].getAttribute('aria-selected')).toBe('true');
    const added = document.createElement('select');
    added.innerHTML = '<option>Added</option>'; root.append(added);
    menus.sync(); added.click();
    expect(added.classList.contains('editor-select')).toBe(true);
    expect(options()[0].textContent).toBe('Added');
  });

  it.each(['disabled', 'hidden', 'fieldset', 'ancestor', 'display', 'visibility', 'dialog'])('cannot open unavailable controls: %s', mode => {
    menus = createEditorSelectMenus(root);
    if (mode === 'disabled') select.disabled = true;
    if (mode === 'hidden') select.hidden = true;
    if (mode === 'fieldset') {
      const fieldset = document.createElement('fieldset'); fieldset.disabled = true;
      select.before(fieldset); fieldset.append(select);
    }
    if (mode === 'ancestor') select.parentElement.hidden = true;
    if (mode === 'display') select.style.display = 'none';
    if (mode === 'visibility') select.style.visibility = 'hidden';
    if (mode === 'dialog') root.open = false;
    pointer(select); select.click(); key('Enter');
    expect(panel().hidden).toBe(true);
  });

  it('closes after locks or visibility change, with explicit sync and asynchronous observation', async () => {
    menus = createEditorSelectMenus(root);
    select.click(); select.disabled = true; menus.sync();
    expect(panel().hidden).toBe(true);
    select.disabled = false; menus.sync(); select.click();
    select.parentElement.hidden = true;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(panel().hidden).toBe(true);
    select.parentElement.hidden = false; select.click();
    select.remove(); menus.sync();
    expect(panel().hidden).toBe(true);
    expect(select.classList.contains('editor-select')).toBe(false);
  });

  it('does not enhance multi-selects or listboxes', () => {
    select.multiple = true; other.size = 3;
    menus = createEditorSelectMenus(root);
    expect(select.classList.contains('editor-select')).toBe(false);
    expect(other.classList.contains('editor-select')).toBe(false);
    select.click();
    expect(panel().hidden).toBe(true);
  });

  it('uses only project-option swatches and synchronizes optional project trigger colors', () => {
    const getColor = vi.fn((select, value) => value === 'alpha' ? '#123456' : '');
    menus = createEditorSelectMenus(root, { getColor });
    expect(select.style.getPropertyValue('--project-color')).toBe('#123456');
    expect(select.classList.contains('has-project-color')).toBe(true);
    select.click();
    expect(options()[1].querySelector('.project-swatch').style.getPropertyValue('--project-color')).toBe('#123456');
    expect(options().every(button => button.querySelector('.project-swatch'))).toBe(true);
    other.click();
    expect(panel().querySelector('.project-swatch')).toBeNull();
    expect(getColor.mock.calls.every(([select]) => select.id === 'creation-project')).toBe(true);
    select.value = 'beta'; menus.sync();
    expect(select.classList.contains('has-project-color')).toBe(false);
    expect(select.style.getPropertyValue('--project-color')).toBe('');
  });

  it('uses the manual top layer API when available and tolerates missing/throwing support', () => {
    menus = createEditorSelectMenus(root);
    panel().showPopover = vi.fn(); panel().hidePopover = vi.fn();
    select.click();
    expect(panel().getAttribute('popover')).toBe('manual');
    expect(panel().showPopover).toHaveBeenCalledOnce();
    menus.close();
    expect(panel().hidePopover).toHaveBeenCalledOnce();
    panel().showPopover.mockImplementation(() => { throw new Error('Unavailable'); });
    panel().hidePopover.mockImplementation(() => { throw new Error('Not open'); });
    expect(() => { select.click(); menus.close(); }).not.toThrow();
    expect(panel().hidden).toBe(true);
  });

  it('flips above, clamps horizontally and limits height to 320px / 45vh / available room', () => {
    menus = createEditorSelectMenus(root);
    select.getBoundingClientRect = () => ({ left: innerWidth - 20, right: innerWidth, top: innerHeight - 68, bottom: innerHeight - 38, width: 20 });
    Object.defineProperties(panel(), { offsetWidth: { value: 240 }, offsetHeight: { value: 140 }, scrollHeight: { value: 500 } });
    select.click();
    expect(panel().style.left).toBe(`${innerWidth - 240 - 8}px`);
    expect(panel().style.top).toBe(`${innerHeight - 68 - 140 - 4}px`);
    expect(parseFloat(panel().style.maxHeight)).toBe(Math.min(320, innerHeight * .45));
    expect(panel().style.margin).toBe('0px');
    select.getBoundingClientRect = () => ({ left: -20, right: 80, top: 100, bottom: 130, width: 100 });
    window.dispatchEvent(new Event('resize'));
    expect(panel().style.left).toBe('8px');
    expect(panel().style.top).toBe('134px');
  });

  it('limits long options to Sprint filter width, unless the native anchor is wider', () => {
    menus = createEditorSelectMenus(root);
    let width = 200;
    select.getBoundingClientRect = () => ({ left: 20, right: 20 + width, top: 100, bottom: 130, width });
    select.click();
    expect(panel().style.minWidth).toBe('200px');
    expect(panel().style.maxWidth).toBe('320px');
    width = 420;
    window.dispatchEvent(new Event('resize'));
    expect(panel().style.minWidth).toBe('420px');
    expect(panel().style.maxWidth).toBe('420px');
    width = innerWidth + 100;
    menus.sync();
    expect(panel().style.minWidth).toBe(`${innerWidth - 16}px`);
    expect(panel().style.maxWidth).toBe(`${innerWidth - 16}px`);
  });

  it('clamps a narrow, short viewport and closes offscreen anchors', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(150);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(200);
    menus = createEditorSelectMenus(root);
    select.getBoundingClientRect = () => ({ left: 2, right: 142, top: 80, bottom: 110, width: 140 });
    Object.defineProperties(panel(), { offsetWidth: { value: 134 }, offsetHeight: { value: 70 }, scrollHeight: { value: 500 } });
    select.click();
    expect(panel().style.minWidth).toBe('134px');
    expect(panel().style.maxWidth).toBe('134px');
    expect(panel().style.maxHeight).toBe('78px');
    expect(panel().style.left).toBe('8px');
    select.getBoundingClientRect = () => ({ left: 200, right: 300, top: 20, bottom: 50, width: 100 });
    window.dispatchEvent(new Event('resize'));
    expect(panel().hidden).toBe(true);
  });

  it('ignores queued external scroll events when the positioned anchor has not moved', () => {
    menus = createEditorSelectMenus(root);
    let top = 400;
    select.getBoundingClientRect = () => ({ left: 20, right: 200, top, bottom: top + 30, width: 180 });
    // Automation/browser scrolls the control into view before activation, but
    // delivery of its scroll event can happen after pointerdown opens the menu.
    top = 100;
    pointer(select); select.click();
    root.dispatchEvent(new Event('scroll'));
    document.dispatchEvent(new Event('scroll'));
    expect(panel().hidden).toBe(false);
    expect(select.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(select);
  });

  it('closes when external scrolling moves the anchor, not when scrolling the options', () => {
    menus = createEditorSelectMenus(root);
    let top = 100;
    select.getBoundingClientRect = () => ({ left: 20, right: 200, top, bottom: top + 30, width: 180 });
    select.click();
    panel().dispatchEvent(new Event('scroll'));
    expect(panel().hidden).toBe(false);
    top = 80;
    root.querySelector('form').dispatchEvent(new Event('scroll'));
    expect(panel().hidden).toBe(true);
    select.click(); root.dispatchEvent(new Event('close'));
    expect(panel().hidden).toBe(true);
  });

  it('uses the latest positioned bounds after resize or sync to identify stale scroll events', () => {
    menus = createEditorSelectMenus(root);
    let left = 20;
    select.getBoundingClientRect = () => ({ left, right: left + 180, top: 100, bottom: 130, width: 180 });
    select.click();
    left = 30; window.dispatchEvent(new Event('resize'));
    document.dispatchEvent(new Event('scroll'));
    expect(panel().hidden).toBe(false);
    left = 40; menus.sync();
    document.dispatchEvent(new Event('scroll'));
    expect(panel().hidden).toBe(false);
    left = 50; document.dispatchEvent(new Event('scroll'));
    expect(panel().hidden).toBe(true);
  });

  it('reveals keyboard options by scrolling only the popup, never dialog ancestors', () => {
    menus = createEditorSelectMenus(root);
    select.click();
    panel().getBoundingClientRect = () => ({ top: 100, bottom: 240 });
    Object.defineProperties(panel(), { clientTop: { value: 2 }, clientHeight: { value: 136 } });
    const first = options()[0], last = options()[3];
    first.getBoundingClientRect = () => ({ top: 80, bottom: 112 });
    last.getBoundingClientRect = () => ({ top: 260, bottom: 292 });
    first.scrollIntoView = vi.fn(); last.scrollIntoView = vi.fn();
    root.scrollTop = 25;
    key('End');
    expect(panel().scrollTop).toBe(54);
    key('Home');
    expect(panel().scrollTop).toBe(32);
    expect(root.scrollTop).toBe(25);
    expect(first.scrollIntoView).not.toHaveBeenCalled();
    expect(last.scrollIntoView).not.toHaveBeenCalled();
    panel().dispatchEvent(new Event('scroll'));
    expect(panel().hidden).toBe(false);
  });

  it('reveals the selected option only after the popup is visible and positioned', () => {
    menus = createEditorSelectMenus(root);
    Object.defineProperties(panel(), {
      clientHeight: { value: 100 }, offsetHeight: { value: 100 }, scrollHeight: { value: 400 },
    });
    const reads = [];
    vi.spyOn(window.HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this === select) return { left: 20, right: 200, top: 20, bottom: 50, width: 180 };
      if (this === panel()) return { top: 54, bottom: 154 };
      if (this.matches('[role="option"]')) {
        reads.push({ hidden: panel().hidden, top: panel().style.top });
        return { top: 254, bottom: 286 };
      }
      return { top: 0, bottom: 0, left: 0, right: 0, width: 0 };
    });
    select.click();
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every(read => !read.hidden && read.top === '54px')).toBe(true);
    expect(panel().scrollTop).toBe(132);
  });

  it('destroy restores preexisting attributes and removes listeners and panel idempotently', () => {
    select.setAttribute('aria-controls', 'old');
    select.setAttribute('aria-expanded', 'false');
    menus = createEditorSelectMenus(root);
    const popup = panel();
    select.click(); menus.destroy(); menus.destroy(); menus.sync();
    expect(popup.isConnected).toBe(false);
    expect(select.getAttribute('aria-controls')).toBe('old');
    expect(select.hasAttribute('aria-haspopup')).toBe(false);
    expect(select.classList.contains('editor-select')).toBe(false);
    expect(select.style.getPropertyValue('--project-color')).toBe('');
    select.click();
    expect(root.querySelector('.editor-select-options')).toBeNull();
  });
});
