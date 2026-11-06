import { useAtlas } from '../app/AtlasContext';
import { Button } from './Button';

/** The way back to the home screen from Decks and Settings, shown in their title row. */
export function BackToHome() {
  const { navigate } = useAtlas();
  return (
    <Button variant="ghost" icon="back" onClick={() => navigate({ name: 'today' })}>
      Home
    </Button>
  );
}
