import '@libraz/mejiro/render/mejiro-fonts.css';
import type { EpubBook } from '@libraz/mejiro/epub';
import {
  MejiroReader,
  MejiroShelf,
  useEpub,
  useLibrary,
  type VolumeInfo,
} from '@libraz/mejiro-react';
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import './styles.css';

interface BookMeta {
  epub: EpubBook;
}

let nextId = 0;

/*
 * v0.5 ships `MejiroShelf` (visual bookshelf) and `useLibrary` (headless
 * volume tracker). Together they replace the hand-rolled shelf from v0.4
 * — drop in any list of `VolumeInfo<T>` and you get card grid + active-id
 * tracking + next/prev/goTo navigation.
 */
export default function App() {
  const [volumes, setVolumes] = useState<VolumeInfo<BookMeta>[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const { loadBuffer, loadFile, loading } = useEpub();

  // The active library cursor is independent of the active *reading* state:
  // pickers move the cursor, opening a volume sets `activeId`.
  const library = useLibrary({ volumes });
  const active = volumes.find((v) => v.id === activeId) ?? null;

  const addBook = useCallback((book: EpubBook): void => {
    nextId += 1;
    setVolumes((prev) => [
      ...prev,
      {
        id: `book-${nextId}`,
        label: book.title,
        author: book.author ?? '',
        meta: { epub: book },
      },
    ]);
  }, []);

  // Pre-populate from the bundled sample if it exists (monorepo demo only).
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/neko.epub');
        if (!res.ok) return;
        const book = await loadBuffer(await res.arrayBuffer());
        if (book) addBook(book);
      } catch {
        /* shelf starts empty */
      }
    })();
  }, [addBook, loadBuffer]);

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const book = await loadFile(file);
    if (book) addBook(book);
  };

  const activeBook = active?.meta?.epub;

  if (active && activeBook) {
    return (
      <MejiroReader
        epub={activeBook}
        subtitle={active.author}
        enableDropZone={false}
        logo={
          <button type="button" className="back-btn" onClick={() => setActiveId(null)}>
            ← 本棚に戻る
          </button>
        }
      />
    );
  }

  return (
    <div className="shelf">
      <MejiroShelf
        volumes={volumes}
        currentId={library.current?.id}
        title="本棚"
        onSelect={(v) => setActiveId(v.id)}
      />
      <div className="shelf-actions">
        <button
          type="button"
          className="add-btn"
          disabled={loading}
          onClick={() => fileRef.current?.click()}
        >
          {loading ? 'Loading…' : '+ Add EPUB'}
        </button>
      </div>
      <input ref={fileRef} type="file" accept=".epub" hidden onChange={onPickFile} />
    </div>
  );
}
