import { useAtlas } from '../../app/AtlasContext';
import { IconButton } from '../../components/IconButton';

export function Study(_props: { deckId: number | null }) {
  const { navigate } = useAtlas();
  return <IconButton icon="back" label="Leave study" shortcut="Esc" onClick={() => navigate({ name: 'today' })} />;
}
