import { beforeEach, describe, expect, it } from 'vitest';
import { reconcileBoard, positionSwimlaneHeaders, alignSwimlanes } from '../src/board-view.js';

// Minimal jKanban adapter: exercise our DOM reconciliation independently of its
// bundled Dragula implementation (real dragging is covered in browser tests).
function boardFixture() {
  const container = document.createElement('div'); document.body.append(container);
  const board = {
    container, options: { boards: [] }, boardContainer: [],
    findBoard: id => [...container.children].find(column => column.dataset.id === id),
    addBoards(definitions) {
      for (const definition of definitions) {
        const column = document.createElement('div'); column.dataset.id = definition.id;
        column.innerHTML = '<header><div class="kanban-title-board"></div></header><main class="kanban-drag"></main>';
        container.append(column);
      }
    },
    addElement(id, item) {
      const node = document.createElement('div'); node.className = 'kanban-item'; node.dataset.eid = item.id;
      if (item.lane) node.dataset.lane = item.lane;
      this.findBoard(id).querySelector('.kanban-drag').append(node);
    },
    removeBoard(id) { this.findBoard(id).remove(); },
  };
  return board;
}
const item = (id, lane) => ({ id: String(id), lane, title: `Card ${id}`, class: [] });
const definition = (items = [], lanes) => ({ id: 'status-1', title: 'New', item: items, lanes });
const lane = id => ({ id, title: id });
beforeEach(() => document.body.replaceChildren());

describe('Card project colours', () => {
  it('applies, updates and clears tint on retained Cards without tinting headings', () => {
    const board = boardFixture();
    const render = projectColor => reconcileBoard(board, [definition([{ ...item(7, '1'), projectColor }], [lane('1')])]);
    render('#ffccff');
    const card = board.container.querySelector('[data-eid="7"]');
    expect(card.style.getPropertyValue('--project-color')).toBe('#ffccff');
    render('#112233');
    expect(board.container.querySelector('[data-eid="7"]')).toBe(card);
    expect(card.style.getPropertyValue('--project-color')).toBe('#112233');
    for (const heading of document.querySelectorAll('.swimlane-heading')) {
      expect(heading.style.getPropertyValue('--project-color')).toBe('');
    }
    render('');
    expect(card.style.getPropertyValue('--project-color')).toBe('');
  });
});

describe('Swimlane reconciliation', () => {
  it('inserts, patches and removes cell actions without changing Cards or drop targets', () => {
    const board = boardFixture();
    const render = action => reconcileBoard(board, [
      definition([item(7, '1')], [{ ...lane('1'), action }, lane('2')]),
      { ...definition([], [lane('1'), lane('2')]), id: 'status-2' },
    ]);
    render();
    const section = board.container.querySelector('.swimlane-section');
    const cards = section.querySelector('.swimlane-cards');
    const card = cards.firstElementChild;
    expect(section.lastElementChild).toBe(cards);
    render('<button type="button">Create</button>');
    const footer = section.querySelector('.swimlane-footer');
    const button = footer.firstElementChild;
    expect(cards.nextElementSibling).toBe(footer);
    expect(footer.parentElement).toBe(section);
    expect(board.container.querySelectorAll('.swimlane-footer')).toHaveLength(1);
    expect(board.boardContainer).toHaveLength(4);
    expect(board.boardContainer.every(node => node.matches('.swimlane-cards'))).toBe(true);
    expect(board.boardContainer).toContain(cards);
    button.focus();
    render('<button type="button">Create</button>');
    expect(document.activeElement).toBe(button);
    render('<button type="button" disabled>Unavailable</button>');
    expect(footer.firstElementChild).toBe(button);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Unavailable');
    expect(cards.children).toHaveLength(1);
    expect(cards.firstElementChild).toBe(card);
    render('');
    expect(section.querySelector('.swimlane-footer')).toBeNull();
    expect(section.lastElementChild).toBe(cards);
    expect(cards.firstElementChild).toBe(card);
  });
  it('includes footer height in row alignment and releases its space when removed', () => {
    const board = boardFixture();
    const definitions = [
      definition([], [{ ...lane('1'), action: '<button>Create</button>' }]),
      { ...definition([], [lane('1')]), id: 'status-2' },
    ];
    reconcileBoard(board, definitions);
    const [first, second] = board.container.querySelectorAll('.swimlane-cards');
    const footer = board.container.querySelector('.swimlane-footer');
    const heading = document.querySelector('.swimlane-headers > .swimlane-heading');
    heading.getBoundingClientRect = () => ({ height: 40 });
    first.getBoundingClientRect = () => ({ height: 100 });
    second.getBoundingClientRect = () => ({ height: 120 });
    footer.getBoundingClientRect = () => ({ height: 36 });
    alignSwimlanes(board.container);
    expect(first.style.minHeight).toBe('100px');
    expect(second.style.minHeight).toBe('136px');
    expect(first.previousElementSibling.style.minHeight).toBe('40px');
    expect(second.previousElementSibling.style.minHeight).toBe('40px');
    // A taller peer grows the Card area above the action, not the footer.
    second.getBoundingClientRect = () => ({ height: 200 });
    alignSwimlanes(board.container);
    expect(first.style.minHeight).toBe('164px');
    expect(second.style.minHeight).toBe('200px');
    delete definitions[0].lanes[0].action;
    second.getBoundingClientRect = () => ({ height: 120 });
    reconcileBoard(board, definitions);
    expect(first.style.minHeight).toBe('120px');
    expect(second.style.minHeight).toBe('120px');
    expect(footer.isConnected).toBe(false);
  });

  for (const occupiedGutter of [0, 15, 20]) {
    it(`keeps the frame full-width even if a scrollport reports a ${occupiedGutter}px gutter`, () => {
      const board = boardFixture();
      reconcileBoard(board, [definition([], [lane('1')]), { ...definition([], [lane('1')]), id: 'status-2' }]);
      const lists = [...board.container.querySelectorAll('.has-swimlanes')];
      lists.forEach((list, index) => {
        list.getBoundingClientRect = () => ({ left: index * 250, right: (index + 1) * 250, top: 0, width: 250, height: 300 });
        Object.defineProperty(list, 'clientWidth', { value: 250 - (index === 1 ? occupiedGutter : 0) });
      });
      positionSwimlaneHeaders(board.container);
      expect(document.querySelector('.swimlane-headers').style.width).toBe('500px');
      expect(lists[1].style.getPropertyValue('--swimlane-scrollbar-inset')).toBe('');
    });
  }
  it('retains one accessible overlay scrollport and removes it when Swimlanes disappear', () => {
    const board = boardFixture();
    reconcileBoard(board, [definition([], [lane('1')])]);
    const scrollbar = document.querySelector('.swimlane-scrollbar');
    expect(scrollbar.getAttribute('role')).toBe('region');
    expect(scrollbar.getAttribute('aria-label')).toBe('Scroll Sprint swimlanes');
    expect(scrollbar.tabIndex).toBe(0);
    expect(scrollbar.firstElementChild.getAttribute('aria-hidden')).toBe('true');
    reconcileBoard(board, [definition([], [lane('1')])]);
    expect(document.querySelectorAll('.swimlane-scrollbar')).toHaveLength(1);
    expect(document.querySelector('.swimlane-scrollbar')).toBe(scrollbar);
    reconcileBoard(board, [definition()]);
    expect(document.querySelector('.swimlane-scrollbar')).toBeNull();
  });
  it('removes empty Ungrouped headings and sections but keeps empty Sprint Columns droppable', () => {
    const board = boardFixture();
    reconcileBoard(board, [definition([item(7, 'ungrouped')], [lane('ungrouped')])]);
    reconcileBoard(board, [definition([], [])]);
    expect(document.querySelector('.swimlane-headers')).toBeNull();
    expect(board.container.querySelector('.swimlane-section')).toBeNull();
    expect(board.boardContainer).toEqual([board.container.querySelector('.kanban-drag')]);
    reconcileBoard(board, [definition([item(7, 'ungrouped')], [lane('ungrouped')])]);
    expect(document.querySelector('.swimlane-headers [data-lane="ungrouped"]')).not.toBeNull();
    expect(board.boardContainer).toEqual([board.container.querySelector('.swimlane-cards')]);
  });
  it('renders one shared heading, preserves its controls and focus, and removes it when flattening', () => {
    const board = boardFixture();
    const lanes = [{ id: '1', title: '<strong>Parent</strong><button>Action</button>' }];
    const definitions = [definition([], lanes), { ...definition([], [{ id: '1', title: '' }]), id: 'status-2' }];
    reconcileBoard(board, definitions);
    expect(document.querySelectorAll('.swimlane-headers > .swimlane-heading')).toHaveLength(1);
    expect([...board.container.querySelectorAll('.swimlane-section > .swimlane-heading')].every(node => node.textContent === '')).toBe(true);
    const button = document.querySelector('.swimlane-headers button'); button.focus();
    reconcileBoard(board, definitions);
    expect(document.activeElement).toBe(button);
    expect(document.querySelector('.swimlane-headers button')).toBe(button);
    reconcileBoard(board, [definition()]);
    expect(document.querySelector('.swimlane-headers')).toBeNull();
  });
  it('removes filtered Cards instead of reattaching them when flattening', () => {
    const board = boardFixture();
    reconcileBoard(board, [definition([item(1), item(2)])]);
    const retained = board.container.querySelector('[data-eid="2"]');
    reconcileBoard(board, [definition([item(2)])]);
    expect(board.container.querySelectorAll('.kanban-item')).toHaveLength(1);
    expect(board.container.querySelector('[data-eid="2"]')).toBe(retained);
    reconcileBoard(board, [definition()]);
    expect(board.container.querySelectorAll('.kanban-item')).toHaveLength(0);
  });
  it('creates sections around existing Cards and keeps Ungrouped last', () => {
    const board = boardFixture();
    reconcileBoard(board, [definition([item(7, 'ungrouped')])]);
    const retained = board.container.querySelector('[data-eid="7"]');
    reconcileBoard(board, [definition([item(7, 'ungrouped')], [lane('ungrouped')])]);
    reconcileBoard(board, [definition([item(7, 'ungrouped'), item(2, '1')], [lane('1'), lane('ungrouped')])]);
    expect([...board.container.querySelectorAll('.swimlane-section')].map(node => node.dataset.lane)).toEqual(['1', 'ungrouped']);
    expect(board.container.querySelector('[data-eid="7"]')).toBe(retained);
    expect(board.boardContainer.every(node => node.className === 'swimlane-cards')).toBe(true);
  });
  it('moves retained Cards between groups without cloning them', () => {
    const board = boardFixture();
    reconcileBoard(board, [definition([item(2, '1')], [lane('1'), lane('ungrouped')])]);
    const retained = board.container.querySelector('[data-eid="2"]');
    reconcileBoard(board, [definition([item(2, 'ungrouped')], [lane('ungrouped')])]);
    expect(board.container.querySelectorAll('.kanban-item')).toHaveLength(1);
    expect(board.container.querySelector('.swimlane-cards').firstElementChild).toBe(retained);
    reconcileBoard(board, [definition([item(2)])]);
    expect(board.container.querySelector('.kanban-drag').firstElementChild).toBe(retained);
    expect(board.container.querySelector('.swimlane-section')).toBeNull();
  });
});
