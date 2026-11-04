/** Made-up flashcards for the blank study screen, so the design can be tried out. Not connected to any real deck. */
export interface MockCard {
  front: string;
  back: string;
}

export const MOCK_CARDS: MockCard[] = [
  { front: 'What is the powerhouse of the cell?', back: 'The mitochondrion, where most of the cell’s ATP is made.' },
  { front: 'What is the derivative of $\\sin x$?', back: '$\\cos x$' },
  { front: 'Which molecule carries amino acids to the ribosome?', back: 'Transfer RNA (tRNA).' },
  { front: 'State the quadratic formula.', back: '$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$' },
  { front: 'Evaluate $\\int_0^1 x^2 \\, dx$.', back: '$\\frac{1}{3}$, because $\\int x^2 \\, dx = \\frac{x^3}{3} + C$.' },
  { front: 'Balance the neutralisation of sulfuric acid by sodium hydroxide.', back: '$$\\ce{H2SO4 + 2NaOH -> Na2SO4 + 2H2O}$$' },
  { front: 'A book costs $5 and a pen costs $2. How much are both?', back: '$7, since $5 + 2 = 7$.' },
  { front: 'What does DNA polymerase do?', back: 'It builds a new DNA strand by adding nucleotides to a template during replication.' },
  { front: 'What is the sum of the interior angles of a triangle?', back: '180°' },
];
