import { beforeEach, describe, expect, it } from 'vitest';
import { reconcileBoard } from '../src/board-view.js';

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

describe('Swimlane reconciliation', () => {
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
