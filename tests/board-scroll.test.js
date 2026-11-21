import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoardScroll } from '../src/board-scroll.js';

beforeEach(() => {
  sessionStorage.clear();
  document.body.innerHTML = '<div id="board"><div data-id="backlog"><main class="kanban-drag"></main></div><div data-id="status-2"><main class="kanban-drag"></main></div></div>';
});
function fixture() {
  const host = document.getElementById('board');
  const list = host.querySelector('[data-id="status-2"] main');
  const backlog = host.querySelector('[data-id="backlog"] main');
  return { host, list, backlog, scroll: createBoardScroll(host) };
}

describe('current-board session scroll', () => {
  it('restores one current scope across controller instances, without touching Backlog', () => {
    const { host, list, backlog, scroll } = fixture();
    scroll.afterRender(scroll.beforeRender('account/project/sprint'));
    host.scrollLeft = 200; list.scrollTop = 150; backlog.scrollTop = 80;
    scroll.save();
    host.scrollLeft = 0; list.scrollTop = 0;
    const reloaded = createBoardScroll(host);
    reloaded.afterRender(reloaded.beforeRender('account/project/sprint'));
    expect(host.scrollLeft).toBe(200);
    expect(list.scrollTop).toBe(150);
    expect(backlog.scrollTop).toBe(80);
    reloaded.afterRender(reloaded.beforeRender('other'));
    expect(list.scrollTop).toBe(0);
    reloaded.afterRender(reloaded.beforeRender('account/project/sprint'));
    expect(host.scrollLeft).toBe(0);
    expect(list.scrollTop).toBe(0);
  });

  it('discards both session and in-memory positions on reset', () => {
    const { host, list, backlog, scroll } = fixture();
    scroll.afterRender(scroll.beforeRender('scope'));
    host.scrollLeft = 200; list.scrollTop = 150; backlog.scrollTop = 80; scroll.save();
    scroll.reset();
    expect(host.scrollLeft).toBe(0);
    expect(list.scrollTop).toBe(0);
    expect(backlog.scrollTop).toBe(80);
    // Late scroll/pagehide events must not recreate the discarded record.
    scroll.save();
    expect(sessionStorage.getItem('redmine-sprint-board.scroll')).toBeNull();
    expect(scroll.beforeRender('scope')).toBeNull();
  });

  it('keeps in-memory refresh preservation when session storage is blocked', () => {
    const access = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    try {
      const { host, list, scroll } = fixture();
      scroll.afterRender(scroll.beforeRender('scope'));
      host.scrollLeft = 200; list.scrollTop = 150;
      const position = scroll.beforeRender('scope');
      host.scrollLeft = 0; list.scrollTop = 0;
      scroll.afterRender(position);
      expect(host.scrollLeft).toBe(200);
      expect(list.scrollTop).toBe(150);
    } finally { access.mockRestore(); }
  });

  it('ignores corrupt session data and invalid numeric offsets', () => {
    sessionStorage.setItem('redmine-sprint-board.scroll', 'not JSON');
    const { host, list, scroll } = fixture();
    expect(scroll.beforeRender('scope')).toBeNull();
    scroll.afterRender({ x: 'bad', columns: [null, { id: 'status-2', y: Infinity }] });
    expect(host.scrollLeft).toBe(0);
    expect(list.scrollTop).toBe(0);
  });
});
