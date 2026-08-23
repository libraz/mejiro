// @vitest-environment happy-dom

import type { ManuscriptDialect } from '@libraz/mejiro/epub';
import { fireEvent, render } from '@testing-library/vue';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readerMock = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}));

vi.mock('../src/MejiroReader.js', () => ({
  // biome-ignore lint/style/useNamingConvention: mocked export name matches the public component.
  MejiroReader: (props: Record<string, unknown>) => {
    readerMock.props = props;
    return null;
  },
}));

import { MejiroManuscriptEditor } from '../src/MejiroManuscriptEditor.js';

const chapters = [{ id: 'c1', title: 'Chapter', body: '**強調**' }];

async function exportChapterXhtml(dialect: ManuscriptDialect | undefined): Promise<string> {
  let resolveBuffer: (buffer: ArrayBuffer) => void = () => {};
  const exported = new Promise<ArrayBuffer>((resolve) => {
    resolveBuffer = resolve;
  });
  const { container } = render(MejiroManuscriptEditor, {
    props: { chapters, dialect, onExport: resolveBuffer },
  });
  await fireEvent.click(container.querySelector('.mejiro-editor-export') as HTMLButtonElement);
  const zip = await JSZip.loadAsync(await exported);
  return zip.file('OPS/Text/chapter-001.xhtml')?.async('string') ?? '';
}

describe('MejiroManuscriptEditor dialect (Vue)', () => {
  beforeEach(() => {
    readerMock.props = null;
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob://stub');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies the dialect to the notation highlighter overlay', () => {
    const narou = render(MejiroManuscriptEditor, { props: { chapters, dialect: 'narou' } });
    expect(
      narou.container.querySelector('.mejiro-notation-overlay [data-token="strong"]'),
    ).toBeNull();

    const mejiro = render(MejiroManuscriptEditor, { props: { chapters } });
    expect(
      mejiro.container.querySelector('.mejiro-notation-overlay [data-token="strong"]')?.textContent,
    ).toBe('**強調**');
  });

  it('applies the dialect to the live preview reader', () => {
    render(MejiroManuscriptEditor, { props: { chapters, dialect: 'narou' } });
    expect(readerMock.props?.dialect).toBe('narou');

    render(MejiroManuscriptEditor, { props: { chapters } });
    expect(readerMock.props?.dialect).toBe('mejiro');
  });

  it('serializes the exported EPUB with the selected dialect', async () => {
    const narou = await exportChapterXhtml('narou');
    expect(narou).toContain('**強調**');
    expect(narou).not.toContain('<strong>');

    const mejiro = await exportChapterXhtml(undefined);
    expect(mejiro).toContain('<strong>強調</strong>');
  });
});
