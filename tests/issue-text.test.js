import { describe, expect, it } from 'vitest';
import { descriptionMarkdown, descriptionHtml, sanitizeDescription, textPatch, assertTextUnchanged } from '../src/issue-text.js';
import { matchesPatch } from '../src/domain.js';

const issue = { subject: 'Original', description: '<p class="legacy">Keep <strong>exactly</strong></p>', status: { id: 1 } };

function rendered(source) {
  const element = document.createElement('div');
  element.innerHTML = descriptionHtml(source);
  return element;
}

describe('issue text editing', () => {
  it('converts ordinary HTML to editable Markdown and back to HTML', () => {
    const source = descriptionMarkdown('<h2>Heading</h2><p><strong>Bold</strong> and <em>italic</em><br>next line</p><ul><li>First</li><li>Second</li></ul>');
    expect(source).toContain('## Heading');
    expect(source).toContain('**Bold**');
    const view = rendered(source);
    expect(view.querySelector('h2').textContent).toBe('Heading');
    expect(view.querySelector('strong').textContent).toBe('Bold');
    expect(view.querySelector('em').textContent).toBe('italic');
    expect(view.querySelector('br')).not.toBeNull();
    expect(view.querySelectorAll('li')).toHaveLength(2);
  });

  it('supports GFM tables, strikethrough, code, links, images and single line breaks', () => {
    const view = rendered('First\nSecond\n\n~~old~~ [link](/issues/1) ![photo](/image.png)\n\n```js\nconst x = "<tag>";\n```\n\n| A | B |\n| --- | --- |\n| one | two |');
    expect(view.querySelector('br')).not.toBeNull();
    expect(view.querySelector('del').textContent).toBe('old');
    expect(view.querySelector('a').getAttribute('href')).toBe('/issues/1');
    expect(view.querySelector('img').getAttribute('src')).toBe('/image.png');
    expect(view.querySelector('code').textContent).toContain('"<tag>"');
    expect(view.querySelector('table td').textContent).toBe('one');
    expect(rendered(descriptionMarkdown(view.innerHTML)).querySelectorAll('table td')).toHaveLength(2);
  });

  it('retains safe HTML outside the Markdown vocabulary', () => {
    const source = descriptionMarkdown('<p>Normal <span class="custom">special</span> text.</p><details><summary>More</summary><p>Details</p></details>');
    expect(source).toContain('<span class="custom">special</span>');
    expect(source).toContain('<details>');
    expect(rendered(source).querySelector('details summary').textContent).toBe('More');
  });

  it('keeps HTML attributes and complex tables that Markdown cannot represent', () => {
    const source = descriptionMarkdown('<table><tr><th colspan="2">Wide</th></tr><tr><td>A</td><td>B</td></tr></table><p class="legacy">Styled</p>');
    const view = rendered(source);
    expect(view.querySelector('th').getAttribute('colspan')).toBe('2');
    expect(view.querySelector('p').className).toBe('legacy');
  });

  it('preserves entities, literal punctuation and nested lists', () => {
    const html = '<p>&lt;literal&gt; &amp; *not emphasis*</p><ol><li>One<ul><li>Nested</li></ul></li></ol><pre><code>&lt;script&gt; &amp; **literal**</code></pre>';
    const view = rendered(descriptionMarkdown(html));
    expect(view.querySelector('p').textContent).toBe('<literal> & *not emphasis*');
    expect(view.querySelector('em')).toBeNull();
    expect(view.querySelector('ol ul li').textContent).toBe('Nested');
    expect(view.querySelector('code').textContent).toContain('<script> & **literal**');
  });

  it('sanitizes both existing HTML and edited Markdown including embedded HTML', () => {
    const unsafe = '<script>alert(1)</script><iframe src="/bad"></iframe><form><input name="x"></form><p id="bad" style="color:red" onclick="alert(1)">Safe</p><a href="javascript:alert(1)">bad link</a><img src="/safe.png" onerror="alert(1)">';
    for (const clean of [sanitizeDescription(unsafe), descriptionHtml(unsafe), descriptionHtml(descriptionMarkdown(unsafe))]) {
      const view = document.createElement('div'); view.innerHTML = clean;
      expect(view.querySelector('script, iframe, form, input, [id], [style], [onclick], [onerror], [href^="javascript:"]')).toBeNull();
      expect(view.textContent).toContain('Safe');
    }
  });

  it('omits an untouched description even on title-only saves', () => {
    const initial = descriptionMarkdown(issue.description);
    expect(textPatch(issue, issue.subject, initial, initial)).toEqual({});
    expect(textPatch(issue, '<new title>', initial, initial)).toEqual({ subject: '<new title>' });
    expect(issue.description).toBe('<p class="legacy">Keep <strong>exactly</strong></p>');
  });

  it('saves edited descriptions as HTML, allows clearing and rejects blank titles', () => {
    expect(textPatch(issue, issue.subject, '**Changed**', 'original').description).toBe('<p><strong>Changed</strong></p>\n');
    expect(textPatch(issue, issue.subject, ' \n', 'original')).toEqual({ description: '' });
    expect(() => textPatch(issue, ' \n', '', '')).toThrow('Title cannot be blank');
  });

  it('blocks only concurrently changed text fields being written', () => {
    expect(() => assertTextUnchanged(issue, { ...issue, subject: 'Someone else' }, { subject: 'Mine' })).toThrow('title changed in Redmine');
    expect(() => assertTextUnchanged(issue, { ...issue, description: '<p>Other</p>' }, { description: '<p>Mine</p>' })).toThrow('description changed in Redmine');
    expect(() => assertTextUnchanged(issue, { ...issue, subject: 'Other' }, { description: '<p>Mine</p>' })).not.toThrow();
    expect(() => assertTextUnchanged(issue, { ...issue, description: 'Other' }, { assigned_to_id: 1 })).not.toThrow();
    expect(() => assertTextUnchanged({ subject: 'x' }, { subject: 'x', description: '' }, { description: '<p>New</p>' })).not.toThrow();
  });

  it('accepts Redmine line-ending normalization but not different description content', () => {
    const original = { ...issue, description: '<p>One</p>\n<p>Two</p>\n' };
    const fresh = { ...original, description: '<p>One</p>\r\n<p>Two</p>\r\n' };
    expect(matchesPatch(fresh, { description: original.description })).toBe(true);
    expect(() => assertTextUnchanged(original, fresh, { description: '<p>New</p>\n' })).not.toThrow();
    expect(matchesPatch(fresh, { description: '<p>One</p>\n<p>Other</p>\n' })).toBe(false);
    expect(matchesPatch(fresh, { description: '<p>One</p>\n<p>Two</p>' })).toBe(false);
    expect(matchesPatch(fresh, { description: '<p>One</p> <p>Two</p>\n' })).toBe(false);
  });

  it('allows an already-retained draft to be verified without overwriting a concurrent edit', () => {
    const patch = { subject: 'Saved title', description: '<p>Saved</p>\n' };
    const saved = { ...issue, subject: patch.subject, description: '<p>Saved</p>\r\n' };
    expect(() => assertTextUnchanged(issue, saved, patch)).not.toThrow();
    expect(matchesPatch(saved, patch)).toBe(true);
    expect(() => assertTextUnchanged(issue, { ...saved, description: '<p>Someone else</p>\r\n' }, patch)).toThrow('description changed in Redmine');
  });

  it('verifies text exactly rather than coercing text to numbers', () => {
    expect(matchesPatch(issue, { subject: 'Original', description: issue.description })).toBe(true);
    expect(matchesPatch(issue, { subject: 'Ignored' })).toBe(false);
    expect(matchesPatch({ ...issue, subject: '01' }, { subject: '1' })).toBe(false);
    expect(matchesPatch({ ...issue, description: null }, { description: '' })).toBe(true);
    expect(matchesPatch(issue, { description: '<p>Changed</p>' })).toBe(false);
  });
});
