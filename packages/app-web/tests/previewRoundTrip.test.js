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
	td.addRule('checkbox', {
		filter: node => node.nodeName === 'DIV' && node.classList.contains('md-checkbox'),
		replacement: (content, node) => {
			const checked = node.classList.contains('checked');
			const text = content.replace(/^[\u2611\u2610\u2612\u2705\u00a0 ]+/, '');
			return `${checked ? '- [x] ' : '- [ ] '}${text}\n`;
		},
	});
	td.addRule('strikethrough', {
		filter: ['del', 's', 'strike'],
		replacement: content => content.trim() ? `~~${content.trim()}~~` : '',
	});
	td.addRule('underline', {
		filter: 'u',
		replacement: content => content.trim() ? `++${content.trim()}++` : '',
	});
	td.addRule('emptyDiv', {
		filter: node => node.nodeName === 'DIV' && !node.classList.length && (!node.textContent.trim() || node.innerHTML === '<br>'),
		replacement: () => '\n<br>\n',
	});
	td.addRule('emptyP', {
		filter: node => node.nodeName === 'P' && !node.querySelector('img') && (!node.textContent.trim() || node.innerHTML === '<br>'),
		replacement: () => '\n\n<br>\n\n',
	});
	let md = td.turndown(dom.window.document.getElementById('root').innerHTML);
	const nl = String.fromCharCode(10);
	const headingGapRe = new RegExp(`^(#{1,6}[^${nl}]*)${nl}{2,}(?=\\S)`, 'gm');
	const headingLeadRe = new RegExp(`([^${nl}])${nl}{2,}(#{1,6}\\s)`, 'g');
	md = md.split('<br/>').join('<br>');
	md = md.split(`<br>${nl}`).join(nl);
	while (md.includes('<br><br>')) md = md.split('<br><br>').join(`<br>${nl}`);
	md = md.replace(headingLeadRe, `$1${nl}$2`);
	md = md.replace(/^(\d+)\.\s+/gm, '$1. ');
	md = md.replace(headingGapRe, `$1${nl}`);
	md = md.replace(new RegExp(`${nl}${nl}<br>$`), '');
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

test('preview round-trip does not add blank line after heading followed by text', () => {
	const body = '# Heading\nBody';
	assert.equal(previewRoundTrip(body), body);
});

test('preview round-trip does not pad around reloaded subheadings', () => {
	const body = 'Intro\n## Heading 2\nBody\n### Heading 3\nMore';
	assert.equal(previewRoundTrip(body), body);
});

test('preview round-trip preserves fenced code block line breaks', () => {
	const body = '```\nline one\nline two\n```';
	assert.equal(previewRoundTrip(body), body);
});

test('preview round-trip preserves mixed formatting note', () => {
	const body = [
		'# Heading 1',
		'Intro with **bold**, *italic*, ++underline++, ~~strike~~, and `inline code`.',
		'## Heading 2',
		'1. First numbered',
		'2. Second numbered',
		'',
		'- Bullet item',
		'',
		'- [ ] Checkbox item',
		'- [x] Checked item',
		'',
		'> Quoted line',
		'',
		'```',
		'code line one',
		'code line two',
		'```',
		'',
		'---',
		'### Heading 3',
		'[Example](https://example.com)',
		'',
		'![image](https://example.com/test.png)',
	].join('\n');
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
