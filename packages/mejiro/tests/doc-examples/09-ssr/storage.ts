/** Stands in for the host application's EPUB storage. */
export async function fetchEpubBuffer(_slug: string): Promise<ArrayBuffer> {
  return (await fetch('/books/example.epub')).arrayBuffer();
}
