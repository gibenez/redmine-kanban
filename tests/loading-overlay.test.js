// @vitest-environment jsdom
import { test, expect, vi } from 'vitest';
import { createLoadingOverlay } from '../src/loading-overlay.js';

test('overlapping logical operations retain the overlay until the final operation finishes', () => {
  const dialog = document.createElement('dialog');
  dialog.showModal = vi.fn(); dialog.close = vi.fn();
  const begin = createLoadingOverlay(dialog);
  const finishFirst = begin(), finishSecond = begin();
  expect(dialog.showModal).toHaveBeenCalledTimes(1);
  finishFirst(); finishFirst();
  expect(dialog.close).not.toHaveBeenCalled();
  finishSecond();
  expect(dialog.close).toHaveBeenCalledTimes(1);
  begin()();
  expect(dialog.showModal).toHaveBeenCalledTimes(2);
  expect(dialog.close).toHaveBeenCalledTimes(2);
});

test('Escape cannot dismiss the blocking overlay', () => {
  const dialog = document.createElement('dialog');
  createLoadingOverlay(dialog);
  const event = new Event('cancel', { cancelable: true });
  dialog.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
});
