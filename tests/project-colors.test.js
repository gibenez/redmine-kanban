import { describe, expect, it } from 'vitest';
import { projectColor } from '../src/project-colors.js';

const project = value => ({ id: 1, custom_fields: [{ id: 9, name: 'Colore', value }] });

describe('projectColor', () => {
  it('reads and normalizes the own-project Colore field, matching numeric or string IDs', () => {
    expect(projectColor([project(' #FFccFF ')], '1')).toBe('#ffccff');
    expect(projectColor([project('#000000')], 1)).toBe('#000000');
  });
  it('does not inherit parent colours or use an issue or unrelated project field', () => {
    const projects = [project('#ffccff'), { id: 2, parent: { id: 1 } }];
    expect(projectColor(projects, 2)).toBe('');
    expect(projectColor(projects, 99)).toBe('');
    expect(projectColor([{ id: 1, custom_fields: [{ name: 'Color', value: '#ffccff' }] }], 1)).toBe('');
  });
  it.each([undefined, null, '', 'red', '#abc', '#ffccff00', '#ggccff', ['#ffccff'], 123, '#ffccff; color:red'])('rejects missing or invalid value %j', value => {
    expect(projectColor([project(value)], 1)).toBe('');
  });
});
