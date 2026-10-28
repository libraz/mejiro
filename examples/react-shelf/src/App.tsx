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

  const { loadBuffer, loadFile, loading, error } = useEpub();

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

  // useEpub loads one book at a time, so every load (sample and picks) runs through one queue.
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const enqueue = useCallback(
    (load: () => Promise<EpubBook | null>): void => {
      queueRef.current = queueRef.current.then(async () => {
        const book = await load();
        if (book) addBook(book);
      });
    },
    [addBook],
  );

  // Pre-populate from the bundled sample if it exists (monorepo demo only).
  const sampleRequestedRef = useRef(false);
  useEffect(() => {
    if (sampleRequestedRef.current) return;
    sampleRequestedRef.current = true;
    enqueue(async () => {
      try {
        const res = await fetch('/neko.epub');
        // A dev server answers a missing file with index.html; that is "no sample".
        if (!res.ok || res.headers.get('content-type')?.includes('text/html')) return null;
        return await loadBuffer(await res.arrayBuffer());
      } catch {
        return null; // shelf starts empty
      }
    });
  }, [enqueue, loadBuffer]);

  const onPickFile = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) enqueue(() => loadFile(file));
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
        {error && (
          <p className="shelf-error" role="alert">
            {error.message}
          </p>
        )}
      </div>
      <input ref={fileRef} type="file" accept=".epub" hidden onChange={onPickFile} />
    </div>
  );
}
