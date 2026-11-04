/** Made-up flashcards for the blank study screen, so the design can be tried out. Not connected to any real deck. */
export interface MockCard {
  front: string;
  back: string;
}

export const MOCK_CARDS: MockCard[] = [
  { front: 'What is the powerhouse of the cell?', back: 'The mitochondrion, where most of the cell’s ATP is made.' },
  { front: 'What is the derivative of sin(x)?', back: 'cos(x)' },
  { front: 'Which molecule carries amino acids to the ribosome?', back: 'Transfer RNA (tRNA).' },
  { front: 'State the quadratic formula.', back: 'x = (−b ± √(b² − 4ac)) / 2a' },
  { front: 'What does DNA polymerase do?', back: 'It builds a new DNA strand by adding nucleotides to a template during replication.' },
  { front: 'What is the sum of the interior angles of a triangle?', back: '180°' },
];
