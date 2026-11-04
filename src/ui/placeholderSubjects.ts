/** Placeholder subjects and sub-decks shared by the sidebar rail and the Today decks card, until real subjects exist. */
export interface PlaceholderSubdeck {
  name: string;
  new: number;
  learn: number;
  due: number;
}

export interface PlaceholderSubject {
  name: string;
  colour: number;
  subdecks: PlaceholderSubdeck[];
}

export const PLACEHOLDER_SUBJECTS: PlaceholderSubject[] = [
  {
    name: 'Biology',
    colour: 1,
    subdecks: [
      { name: 'Sub-deck one', new: 12, learn: 3, due: 24 },
      { name: 'Sub-deck two', new: 5, learn: 0, due: 11 },
    ],
  },
  {
    name: 'Maths',
    colour: 3,
    subdecks: [
      { name: 'Sub-deck one', new: 8, learn: 2, due: 17 },
      { name: 'Sub-deck two', new: 0, learn: 0, due: 6 },
      { name: 'Sub-deck three', new: 20, learn: 4, due: 0 },
    ],
  },
];
