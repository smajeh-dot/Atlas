import type { NoteType } from './model';

export const BUILTIN_NOTE_TYPES: Omit<NoteType, 'id'>[] = [
  {
    name: 'Basic', kind: 'standard', builtin: 'basic', css: '',
    fields: [{ name: 'Front' }, { name: 'Back' }],
    templates: [{ name: 'Card 1', front: '{{Front}}', back: '{{FrontSide}}<hr id=answer>{{Back}}' }],
  },
  {
    name: 'Basic and reversed', kind: 'standard', builtin: 'basic_reversed', css: '',
    fields: [{ name: 'Front' }, { name: 'Back' }],
    templates: [
      { name: 'Card 1', front: '{{Front}}', back: '{{FrontSide}}<hr id=answer>{{Back}}' },
      { name: 'Card 2', front: '{{Back}}', back: '{{FrontSide}}<hr id=answer>{{Front}}' },
    ],
  },
  {
    name: 'Type the answer', kind: 'standard', builtin: 'basic_typein', css: '',
    fields: [{ name: 'Front' }, { name: 'Back' }],
    templates: [{ name: 'Card 1', front: '{{Front}}{{type:Back}}', back: '{{Front}}<hr id=answer>{{type:Back}}' }],
  },
  {
    name: 'Cloze', kind: 'cloze', builtin: 'cloze', css: '',
    fields: [{ name: 'Text' }, { name: 'Extra' }],
    templates: [{ name: 'Cloze', front: '{{cloze:Text}}', back: '{{cloze:Text}}<hr id=answer>{{Extra}}' }],
  },
];
