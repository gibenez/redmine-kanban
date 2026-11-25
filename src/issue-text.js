import DOMPurify from 'dompurify';
import { sameIssueText } from './domain.js';
import { Marked } from 'marked';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const markdown = new Marked({ gfm: true, breaks: true });
const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
converter.use(gfm);
const escapeMarkdown = converter.escape.bind(converter);
// Decoded text must not become raw HTML (or an entity) when parsed again.
converter.escape = text => escapeMarkdown(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Keep safe structures that Markdown cannot express, rather than losing their content.
const markdownTags = new Set('p br h1 h2 h3 h4 h5 h6 blockquote ul ol li pre code hr em i strong b del s strike a img table thead tbody tr th td'.split(' '));
const markdownAttributes = { a: ['href', 'title'], img: ['src', 'alt', 'title'], ol: ['start'], th: ['align'], td: ['align'], code: ['class'] };
converter.addRule('retainHtml', {
  filter: node => {
    const tag = node.nodeName.toLowerCase();
    return !markdownTags.has(tag)
      || [...node.attributes].some(attribute => !(markdownAttributes[tag] || []).includes(attribute.name))
      || (tag === 'table' && Boolean(node.querySelector('[colspan], [rowspan], table')));
  },
  replacement: (_content, node) => node.isBlock ? `\n\n${node.outerHTML}\n\n` : node.outerHTML,
});

export function sanitizeDescription(html) {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'select', 'textarea', 'iframe'],
    FORBID_ATTR: ['style', 'id', 'name', 'autofocus'],
  });
}

export function descriptionMarkdown(html) {
  return converter.turndown(sanitizeDescription(html || ''));
}

export function descriptionHtml(source) {
  return source.trim() ? sanitizeDescription(markdown.parse(source)) : '';
}

export function textPatch(issue, subject, source, initialSource) {
  if (!subject.trim()) throw new Error('Title cannot be blank.');
  const patch = {};
  if (subject !== issue.subject) patch.subject = subject;
  if (source !== initialSource) patch.description = descriptionHtml(source);
  return patch;
}

export function assertTextUnchanged(original, fresh, patch) {
  for (const key of ['subject', 'description']) {
    // A previous write may have succeeded despite a lost response/read-back.
    // Already-retained text needs verification, not another write or a conflict.
    if (Object.hasOwn(patch, key) && !sameIssueText(key, fresh[key], patch[key]) && !sameIssueText(key, fresh[key], original[key])) {
      throw new Error(`The ${key === 'subject' ? 'title' : 'description'} changed in Redmine after you opened this issue. Copy your draft, then close and reopen the issue before saving.`);
    }
  }
}
