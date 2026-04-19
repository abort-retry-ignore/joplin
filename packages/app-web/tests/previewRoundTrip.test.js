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
	const nl = String.fromCharCode(10);
	md = md.split('<br/>').join('<br>');
	md = md.split(`<br>${nl}`).join(nl);
	while (md.includes('<br><br>')) md = md.split('<br><br>').join(`<br>${nl}`);
	let out = '';
	for (let i = 0; i < md.length; i++) {
		const ch = md.charAt(i);
		const nx = md.charAt(i + 1);
		if (ch === '\\' && ['[', ']', '`', '*', '_', '\\', '$'].includes(nx)) {
			out += nx;
			i += 1;
			continue;
		}
		out += ch;
	}
	return out;
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
	assert.equal(previewRoundTrip(body), body);
});

test('logged in layout includes htmlToMarkdown normalization for preview save', () => {
	const html = layoutPage({ user: { email: 'user@example.com', fullName: 'User' }, navContent: '' });
	assert.ok(html.includes('function htmlToMarkdown(el){'));
	assert.ok(html.includes('var nl=String.fromCharCode(10);'));
	assert.ok(html.includes('md=md.split(\'<br/>\').join(\'<br>\')'));
	assert.ok(html.includes('while(md.indexOf(\'<br><br>\')>=0)'));
	assert.ok(html.includes('ch.charCodeAt(0)===92'));
	assert.ok(html.includes('return out'));
});
