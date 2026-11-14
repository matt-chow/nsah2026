import { memo } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { upsert, type JournalEntry } from '../../lib/journal.ts';
import { journal, useJournal } from './store.ts';

interface Props {
  id: string;
  make: () => JournalEntry;
  label: string;
}

/** Save to / remove from the field notebook. The entry is built only when saving. */
export const BookmarkButton = memo(function BookmarkButton({ id, make, label }: Props) {
  const saved = useJournal().some((e) => e.id === id);
  return (
    <button
      type="button"
      className="bookmark"
      aria-pressed={saved}
      title={saved ? 'Saved in your journal; press to remove' : `Save ${label} to your journal`}
      onClick={() =>
        journal.set(
          saved ? journal.get().filter((e) => e.id !== id) : upsert(journal.get(), make()),
        )
      }
    >
      <Icon name={saved ? 'bookmarked' : 'bookmark'} />
      {saved ? 'Saved' : 'Save'}
      <span className="visually-hidden"> {label}</span>
    </button>
  );
});
