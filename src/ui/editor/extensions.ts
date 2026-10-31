import { Extension, Node, mergeAttributes, type AnyExtension } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import katex from 'katex';
import { nextClozeNumber } from '../../core/cloze';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    atlas: {
      /** Wraps the selection in {{cN::…}}; with nothing selected, leaves the cursor inside. */
      wrapCloze: (n: number) => ReturnType;
      /** Inserts an empty inline equation and opens it for typing TeX. */
      insertMath: () => ReturnType;
      insertImage: (name: string) => ReturnType;
    };
  }
}

const BARE = /^[^/\\:?#]+$/;
const DATA_IMAGE = /^data:image\//i;
const safeSrc = (src: string | null) => !!src && (DATA_IMAGE.test(src) || (BARE.test(src) && !src.startsWith('.')));

/** Images keep the bare media name in the field (spec 5) but display through the media URL. */
function atlasImage(mediaUrl: (name: string) => string) {
  return Node.create({
    name: 'image',
    inline: true,
    group: 'inline',
    atom: true,
    draggable: true,
    addAttributes: () => ({ src: { default: null } }),
    parseHTML: () => [{
      tag: 'img[src]',
      // Pasted remote images and paths are dropped: only media names and data: images survive.
      getAttrs: (el) => (safeSrc((el as HTMLElement).getAttribute('src')) ? { src: (el as HTMLElement).getAttribute('src') } : false),
    }],
    renderHTML: ({ HTMLAttributes }) => ['img', mergeAttributes(HTMLAttributes)],
    addNodeView: () => ({ node }) => {
      const img = document.createElement('img');
      const src = String(node.attrs.src);
      img.setAttribute('src', BARE.test(src) ? mediaUrl(src) : src);
      img.className = 'atlas-editor-image';
      return { dom: img };
    },
    addCommands: () => ({
      insertImage: (name: string) => ({ commands }) => commands.insertContent({ type: 'image', attrs: { src: name } }),
    }),
  });
}

/** An equation: rendered with KaTeX, or a TeX text box while it is being edited. */
const MathNode = Node.create({
  name: 'math',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  addAttributes: () => ({ tex: { default: '' }, display: { default: false } }),
  parseHTML: () => [{
    tag: 'span[data-math]',
    getAttrs: (el) => ({ tex: (el as HTMLElement).textContent ?? '', display: (el as HTMLElement).dataset.math === 'display' }),
  }],
  renderHTML: ({ node }) => ['span', { 'data-math': node.attrs.display ? 'display' : 'inline' }, String(node.attrs.tex)],
  addCommands: () => ({
    insertMath: () => ({ state, chain }) => {
      const at = state.selection.from;
      return chain()
        .insertContent({ type: 'math', attrs: { tex: '', display: false } })
        .command(({ tr }) => {
          tr.setSelection(NodeSelection.create(tr.doc, at));
          return true;
        })
        .run();
    },
  }),
  addKeyboardShortcuts() {
    return { 'Mod-m': () => this.editor.commands.insertMath() };
  },
  addNodeView: () => ({ node, getPos, editor }) => {
    let current = node;
    let editing = false;
    /** What the TeX box holds; follows the node until the person types. */
    let draft = String(node.attrs.tex);
    let dirty = false;
    const dom = document.createElement('span');
    dom.className = 'atlas-math';
    dom.contentEditable = 'false';

    const save = (tex: string, display: boolean) => {
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos === undefined) return;
      editing = false;
      dirty = false;
      if (!tex.trim()) {
        editor.chain().command(({ tr }) => {
          tr.delete(pos, pos + current.nodeSize);
          return true;
        }).focus().run();
        return;
      }
      editor.chain().command(({ tr }) => {
        tr.setNodeMarkup(pos, undefined, { tex, display });
        return true;
      }).setTextSelection(pos + 1).focus().run();
      render();
    };

    const render = () => {
      dom.replaceChildren();
      if (!editing) {
        dom.dataset.editing = 'false';
        const out = document.createElement('span');
        katex.render(String(current.attrs.tex) || '\\square', out, { throwOnError: false, displayMode: !!current.attrs.display });
        dom.append(out);
        return;
      }
      dom.dataset.editing = 'true';
      const input = document.createElement('input');
      input.className = 'atlas-math-input';
      input.setAttribute('aria-label', 'Equation (TeX)');
      input.placeholder = 'TeX, e.g. x^2';
      input.value = draft;
      input.addEventListener('input', () => {
        draft = input.value;
        dirty = true;
      });
      const own = document.createElement('label');
      own.className = 'atlas-math-own';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!current.attrs.display;
      own.append(box, ' Own line');
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          save(draft, box.checked);
        }
      });
      input.addEventListener('blur', () => setTimeout(() => {
        if (editing && document.activeElement !== box && document.activeElement !== input) save(draft, box.checked);
      }, 0));
      box.addEventListener('change', () => input.focus());
      dom.append(input, own);
      queueMicrotask(() => input.focus());
    };

    dom.addEventListener('mousedown', (e) => {
      if (editing) return;
      e.preventDefault();
      editing = true;
      dirty = false;
      draft = String(current.attrs.tex);
      render();
    });
    render();
    return {
      dom,
      update: (next) => {
        if (next.type !== current.type) return false;
        current = next;
        if (!dirty) draft = String(next.attrs.tex);
        if (!editing) render();
        else {
          const input = dom.querySelector<HTMLInputElement>('.atlas-math-input');
          if (input && !dirty) input.value = draft;
        }
        return true;
      },
      selectNode: () => {
        if (editing) return;
        editing = true;
        dirty = false;
        draft = String(current.attrs.tex);
        render();
      },
      deselectNode: () => {
        const input = dom.querySelector<HTMLInputElement>('.atlas-math-input');
        if (editing && input && document.activeElement !== input) save(draft, !!dom.querySelector<HTMLInputElement>('input[type=checkbox]')?.checked);
      },
      stopEvent: (e) => editing && dom.contains(e.target as globalThis.Node),
      ignoreMutation: () => true,
    };
  },
});

function clozeKeys(getAllText: () => string) {
  return Extension.create({
    name: 'atlasCloze',
    addCommands: () => ({
      wrapCloze: (n: number) => ({ state, chain }) => {
        const { from, to } = state.selection;
        const open = `{{c${n}::`;
        if (from === to) {
          return chain().insertContentAt(from, `${open}}}`).setTextSelection(from + open.length).run();
        }
        // Insert the end first so the start position is still right.
        return chain().insertContentAt(to, '}}').insertContentAt(from, open).setTextSelection(to + open.length + 2).run();
      },
    }),
    addKeyboardShortcuts() {
      return {
        'Mod-Shift-c': () => this.editor.commands.wrapCloze(nextClozeNumber(getAllText(), false)),
        'Mod-Alt-Shift-c': () => this.editor.commands.wrapCloze(nextClozeNumber(getAllText(), true)),
      };
    },
  });
}

export function atlasExtensions(opts: { mediaUrl(name: string): string; getAllText(): string; onSubmit?(): void }): AnyExtension[] {
  return [
    StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, horizontalRule: false, link: false, code: false, strike: false }),
    // Their built-in Ctrl+. and Ctrl+, are replaced by the spec's keys below; Ctrl+, opens Settings.
    Superscript.extend({ addKeyboardShortcuts: () => ({}) }),
    Subscript.extend({ addKeyboardShortcuts: () => ({}) }),
    // One keymap for both, so Ctrl+Shift+= is never read as Ctrl+= by a keymap that ignores Shift.
    Extension.create({
      name: 'atlasScripts',
      priority: 200,
      addKeyboardShortcuts() {
        return {
          'Mod-Shift-=': () => this.editor.commands.toggleSuperscript(),
          'Mod-+': () => this.editor.commands.toggleSuperscript(),
          'Mod-=': () => this.editor.commands.toggleSubscript(),
        };
      },
    }),
    atlasImage(opts.mediaUrl),
    MathNode,
    clozeKeys(opts.getAllText),
    // Ctrl+Enter adds or saves the note (spec 11). The editor would otherwise insert a line break
    // and keep the key from ever reaching the screen.
    Extension.create({
      name: 'atlasSubmit',
      priority: 1000,
      addKeyboardShortcuts() {
        return {
          'Mod-Enter': () => {
            opts.onSubmit?.();
            return true;
          },
        };
      },
    }),
  ];
}
