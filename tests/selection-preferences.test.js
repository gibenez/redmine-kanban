import { describe, expect, it } from 'vitest';
import { createSelectionPreferences } from '../src/selection-preferences.js';

function storageFixture() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

describe('selection preferences', () => {
  it('restores explicit project and per-project Sprint IDs across instances', () => {
    const storage = storageFixture();
    const first = createSelectionPreferences('https://redmine.test/', 7, () => storage);
    expect(first.project()).toBeNull();
    first.selectProject(2); first.selectSprint(1, 10); first.selectSprint(2, 20);
    const restored = createSelectionPreferences('https://redmine.test', 7, () => storage);
    expect(restored.project()).toBe('2');
    expect(restored.sprint(1)).toBe('10');
    expect(restored.sprint(2)).toBe('20');
  });

  it('isolates servers and users without using credentials', () => {
    const storage = storageFixture();
    createSelectionPreferences('https://redmine.test/a', 7, () => storage).selectProject(2);
    expect(createSelectionPreferences('https://redmine.test/b', 7, () => storage).project()).toBeNull();
    expect(createSelectionPreferences('https://redmine.test/a', 8, () => storage).project()).toBeNull();
  });

  it('ignores malformed IDs', () => {
    const storage = storageFixture();
    const preferences = createSelectionPreferences('https://redmine.test', 7, () => storage);
    preferences.selectProject(1);
    const key = [...storage.values.keys()][0];
    for (const value of ['{bad json', 'null', '-1', '0', '1.5', 'Infinity', '9007199254740992']) {
      storage.values.set(key, value);
      expect(createSelectionPreferences('https://redmine.test', 7, () => storage).project()).toBeNull();
    }
    preferences.selectSprint(1, null);
    expect(preferences.sprint(1)).toBeNull();
  });

  it('keeps this tab functional when storage access throws', () => {
    const preferences = createSelectionPreferences('https://redmine.test', 7, () => { throw new Error('Blocked'); });
    expect(preferences.project()).toBeNull();
    preferences.selectProject(2); preferences.selectSprint(2, 20);
    expect(preferences.project()).toBe('2');
    expect(preferences.sprint(2)).toBe('20');
  });

  it('preserves other projects when different tabs save selections', () => {
    const storage = storageFixture();
    const first = createSelectionPreferences('https://redmine.test', 7, () => storage);
    const second = createSelectionPreferences('https://redmine.test', 7, () => storage);
    first.selectSprint(1, 10); second.selectSprint(2, 20);
    expect(first.sprint(2)).toBe('20');
    expect(second.sprint(1)).toBe('10');
  });
});
