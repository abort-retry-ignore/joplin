const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createRequire } = require('module');
const { renderMarkdown, layoutPage } = require('../app/templates');

const workspaceRequire = createRequire(path.join(__dirname, '../../lib/package.json'));
const { JSDOM } = workspaceRequire('jsdom');
const TurndownService = require('../../turndown/lib/turndown.cjs.js');

const previewRoundTrip = markdown => {
	const html = renderMarkdown(markdown);
	const dom = new JSDOM(`<div id="root">${html}</div>`);
	const td = new TurndownService({
		headingStyle: 'atx',
		hr: '---',
		codeBlockStyle: 'fenced',
		bulletListMarker: '-',
		emDelimiter: '*',
		strongDelimiter: '**',
		br: '<br>',
	});
	let md = td.turndown(dom.window.document.getElementById('root').innerHTML);
	md = md.replace(/(?:<br>\n?)+/g, match => {
		const count = (match.match(/<br>/g) || []).length;
		if (count === 1) return '\n';
		return `\n${Array.from({ length: (count - 1) / 2 }, () => '<br>\n').join('')}`;
	});
	return md.replace(/\\(\[|\]|\x60|\*|_|\\|\$)/g, '$1');
};

test('preview round-trip preserves printable ascii', () => {
	const asciiBody = Array.from({ length: 95 }, (_value, index) => {
		const code = index + 32;
		return `${String(code).padStart(3, '0')}: before${String.fromCharCode(code)}after`;
	}).join('\n');
	assert.equal(previewRoundTrip(asciiBody), asciiBody);
});

test('preview round-trip preserves blank-line markers', () => {
	const body = 'line one\n<br>\nline two\n<br>\n<br>\nline three';
	assert.equal(previewRoundTrip(body), 'line one\n<br/><br/>line two\n<br/><br/><br/><br/>line three');
});

test('logged in layout includes htmlToMarkdown normalization for preview save', () => {
	const html = layoutPage({ user: { email: 'user@example.com', fullName: 'User' }, navContent: '' });
	assert.ok(html.includes('function htmlToMarkdown(el){'));
	assert.ok(html.includes('match(/<br>/g)'));
	assert.ok(html.includes('return md.replace('));
});
