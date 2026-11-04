import { describe, expect, test } from 'vitest';
import { mediaReferences, planMedia, rewriteReferences, type StagedMedia } from '../../src/import/media';

const m = (name: string, sha1: string, originalName = name): StagedMedia => ({
  name, originalName, sha1, size: 3, stagedPath: `media/${name.length}`,
});

describe('planMedia', () => {
  test('new files are installed under their own names', () => {
    const plan = planMedia([m('a.png', 'aaaa1111bbbb')], []);
    expect(plan.install.map((i) => i.name)).toEqual(['a.png']);
    expect(plan.renames.size).toBe(0);
  });

  test('the same file Atlas already has is reused, ignoring case', () => {
    const plan = planMedia([m('Diagram.PNG', 'same')], [{ name: 'diagram.png', sha1: 'same' }]);
    expect(plan.install).toEqual([]);
    // References in the notes keep working because they now point at Atlas's spelling.
    expect(plan.renames.get('Diagram.PNG')).toBe('diagram.png');
  });

  test('a different file with a taken name gets the content hash in its name', () => {
    const plan = planMedia([m('diagram.png', '0123456789abcdef')], [{ name: 'Diagram.png', sha1: 'other' }]);
    expect(plan.install.map((i) => i.name)).toEqual(['diagram-01234567.png']);
    expect(plan.renames.get('diagram.png')).toBe('diagram-01234567.png');
    expect(plan.renamedForCollision).toEqual(['diagram.png']);
  });

  test('importing the same media twice installs nothing the second time', () => {
    const files = [m('a.png', 'x1x1x1x1x1'), m('b.mp3', 'y2y2y2y2y2')];
    const first = planMedia(files, []);
    const second = planMedia(files, first.install.map((i) => ({ name: i.name, sha1: i.sha1 })));
    expect(second.install).toEqual([]);
  });

  test("a name the package reader made safe for Windows is mapped from the original", () => {
    const plan = planMedia([m('_CON.png', 'z9', 'CON.png')], []);
    expect(plan.renames.get('CON.png')).toBe('_CON.png');
    expect(plan.known.has('con.png')).toBe(true);
  });

  test('NFC and NFD spellings are the same name', () => {
    const plan = planMedia([m('café.png', 'one')], [{ name: 'café.png', sha1: 'one' }]);
    expect(plan.install).toEqual([]);
  });
});

describe('references', () => {
  const html = [
    '<img src="a b.png">',
    "<img class=x src='c.png'>",
    '<img src=d.png>',
    '[sound:e.mp3]',
    '<div style="background: url(\'f.png\')">',
    '<audio><source src="g.ogg"></audio>',
    '<object data="h.svg"></object>',
    '<img src="https://example.com/remote.png">',
    '<img src="data:image/png;base64,xyz">',
    '<img src="tom &amp; jerry.png">',
  ].join('');

  test('every kind of reference is found; remote and inline images are not files', () => {
    expect(mediaReferences(html).sort()).toEqual(
      ['a b.png', 'c.png', 'd.png', 'e.mp3', 'f.png', 'g.ogg', 'h.svg', 'tom & jerry.png'].sort(),
    );
  });

  test('only renamed files are rewritten, and nothing else changes', () => {
    const renames = new Map([
      ['a b.png', 'a b-1234.png'],
      ['e.mp3', 'e-5678.mp3'],
      ['f.png', 'f2.png'],
      ['tom & jerry.png', 'tom & jerry-9.png'],
    ]);
    const out = rewriteReferences(html, renames);
    expect(out).toBe(
      html
        .replace('"a b.png"', '"a b-1234.png"')
        .replace('[sound:e.mp3]', '[sound:e-5678.mp3]')
        .replace("url('f.png')", "url('f2.png')")
        .replace('tom &amp; jerry.png', 'tom &amp; jerry-9.png'),
    );
    expect(rewriteReferences(html, new Map())).toBe(html);
  });

  test('a name that merely contains a renamed name is left alone', () => {
    expect(rewriteReferences('<img src="xa.png"><img src="a.png">', new Map([['a.png', 'b.png']]))).toBe(
      '<img src="xa.png"><img src="b.png">',
    );
  });
});
