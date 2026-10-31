// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, expect, test } from 'vitest';
import { atlasExtensions } from '../../../src/ui/editor/extensions';
import { fromEditorHtml, toEditorHtml } from '../../../src/ui/editor/fieldHtml';

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));

function editor(field: string, allText = () => field, onSubmit?: () => void) {
  const element = document.createElement('div');
  document.body.append(element);
  const e = new Editor({ element, extensions: atlasExtensions({ mediaUrl: (n) => `media://${n}`, getAllText: allText, onSubmit }), content: toEditorHtml(field) });
  editors.push(e);
  return e;
}

test('wrapCloze wraps the selection with the given number', () => {
  const e = editor('The mitochondria');
  e.commands.setTextSelection({ from: 5, to: 17 });
  e.commands.wrapCloze(1);
  expect(fromEditorHtml(e.getHTML())).toBe('The {{c1::mitochondria}}');
});

test('wrapCloze with no selection leaves the cursor inside the cloze', () => {
  const e = editor('A B');
  e.commands.setTextSelection(3);
  e.commands.wrapCloze(2);
  e.commands.insertContent('wall');
  expect(fromEditorHtml(e.getHTML())).toBe('A {{c2::wall}}B');
});

test('Ctrl+Shift+C uses the next number across all fields; Ctrl+Alt+Shift+C reuses the last', () => {
  const e = editor('{{c1::a}} b c', () => '{{c1::a}} b c|{{c2::x}}');
  e.commands.setTextSelection({ from: 11, to: 12 });
  e.commands.keyboardShortcut('Mod-Shift-c');
  expect(fromEditorHtml(e.getHTML())).toBe('{{c1::a}} {{c3::b}} c');
  const f = editor('{{c1::a}} b', () => '{{c1::a}} b');
  f.commands.setTextSelection({ from: 11, to: 12 });
  f.commands.keyboardShortcut('Mod-Alt-Shift-c');
  expect(fromEditorHtml(f.getHTML())).toBe('{{c1::a}} {{c1::b}}');
});

test('images serialise as bare names but display through mediaUrl', () => {
  const e = editor('<img src="paste-abc123def456.png">');
  expect(e.getHTML()).toContain('src="paste-abc123def456.png"');
  expect(e.view.dom.querySelector('img.atlas-editor-image')!.getAttribute('src')).toBe('media://paste-abc123def456.png');
});

test('insertImage adds a bare-named image', () => {
  const e = editor('a');
  e.commands.setTextSelection(2);
  e.commands.insertImage('paste-000000000000.png');
  expect(fromEditorHtml(e.getHTML())).toBe('a<img src="paste-000000000000.png">');
});

test('pasted remote images and scripts are dropped; data images survive', () => {
  const e = editor('');
  e.commands.insertContent('<p>Hi<img src="https://evil/x.png"><img src="../up.png"><script>alert(1)</script><img src="data:image/png;base64,AAAA"></p>');
  const html = fromEditorHtml(e.getHTML());
  expect(html).not.toMatch(/evil|up\.png|script/);
  expect(html).toContain('data:image/png;base64,AAAA');
});

test('insertMath inserts an inline equation stored as \\( \\)', () => {
  const e = editor('a');
  e.commands.setTextSelection(2);
  e.commands.insertMath();
  e.commands.updateAttributes('math', { tex: 'x^2' });
  expect(fromEditorHtml(e.getHTML())).toBe('a\\(x^2\\)');
});

test('equations render with KaTeX when not being edited', () => {
  const e = editor('E \\(x^2\\)');
  expect(e.view.dom.querySelector('.katex')).not.toBeNull();
});

test('superscript and subscript marks', () => {
  const e = editor('H2O x2');
  e.commands.setTextSelection({ from: 2, to: 3 });
  e.commands.toggleSubscript();
  e.commands.setTextSelection({ from: 6, to: 7 });
  e.commands.toggleSuperscript();
  expect(fromEditorHtml(e.getHTML())).toBe('H<sub>2</sub>O x<sup>2</sup>');
});

test('Ctrl+Shift+= is superscript and Ctrl+= is subscript', () => {
  const e = editor('x2');
  e.commands.setTextSelection({ from: 2, to: 3 });
  e.commands.keyboardShortcut('Mod-Shift-=');
  expect(fromEditorHtml(e.getHTML())).toBe('x<sup>2</sup>');
  const f = editor('x2');
  f.commands.setTextSelection({ from: 2, to: 3 });
  f.commands.keyboardShortcut('Mod-=');
  expect(fromEditorHtml(f.getHTML())).toBe('x<sub>2</sub>');
});

test('Ctrl+Enter submits the note instead of inserting a line break', () => {
  let submitted = 0;
  const e = editor('Front text', undefined, () => submitted++);
  e.commands.setTextSelection(11);
  e.commands.keyboardShortcut('Mod-Enter');
  expect(submitted).toBe(1);
  expect(fromEditorHtml(e.getHTML())).toBe('Front text');
});
