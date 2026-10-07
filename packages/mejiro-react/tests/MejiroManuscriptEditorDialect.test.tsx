// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { ManuscriptDialect } from '@libraz/mejiro/epub';
import { fireEvent, render } from '@testing-library/react';
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

import { enMessages } from '../src/i18n.js';
import { MejiroManuscriptEditor } from '../src/MejiroManuscriptEditor.js';

const chapters = [{ id: 'c1', title: 'Chapter', body: '**強調**' }];

async function exportChapterXhtml(dialect: ManuscriptDialect | undefined): Promise<string> {
  let resolveBuffer: (buffer: ArrayBuffer) => void = () => {};
  const exported = new Promise<ArrayBuffer>((resolve) => {
    resolveBuffer = resolve;
  });
  const { container } = render(
    <MejiroManuscriptEditor chapters={chapters} dialect={dialect} onExport={resolveBuffer} />,
  );
  fireEvent.click(container.querySelector('.mejiro-editor-export') as HTMLButtonElement);
  const zip = await JSZip.loadAsync(await exported);
  return zip.file('OPS/Text/chapter-001.xhtml')?.async('string') ?? '';
}

describe('MejiroManuscriptEditor dialect (React)', () => {
  beforeEach(() => {
    readerMock.props = null;
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob://stub');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies the dialect to the notation highlighter overlay', () => {
    const narou = render(<MejiroManuscriptEditor chapters={chapters} dialect="narou" />);
    expect(
      narou.container.querySelector('.mejiro-notation-overlay [data-token="strong"]'),
    ).toBeNull();

    const mejiro = render(<MejiroManuscriptEditor chapters={chapters} />);
    expect(
      mejiro.container.querySelector('.mejiro-notation-overlay [data-token="strong"]')?.textContent,
    ).toBe('**強調**');
  });

  it('offers only notation buttons whose markup the dialect parses', () => {
    const tokenOf: Record<string, string> = {
      [enMessages.manuscriptEmphasisDots]: 'emphasis',
      [enMessages.manuscriptTcy]: 'tcy',
      [enMessages.manuscriptEm]: 'em',
      [enMessages.manuscriptStrong]: 'strong',
    };
    const body = [{ id: 'c1', title: 'Chapter', body: '20' }];
    for (const dialect of ['mejiro', 'narou', 'kakuyomu'] as const) {
      const probe = render(<MejiroManuscriptEditor chapters={body} dialect={dialect} />);
      const labels = Array.from(
        probe.container.querySelectorAll('.mejiro-editor-notation button'),
      ).map((button) => button.textContent ?? '');
      probe.unmount();
      expect(labels.length, dialect).toBe(dialect === 'mejiro' ? 4 : 0);
      for (const label of labels) {
        const view = render(<MejiroManuscriptEditor chapters={body} dialect={dialect} />);
        const textarea = view.container.querySelector('textarea') as HTMLTextAreaElement;
        textarea.setSelectionRange(0, 2);
        const button = Array.from(
          view.container.querySelectorAll('.mejiro-editor-notation button'),
        ).find((b) => b.textContent === label) as HTMLButtonElement;
        fireEvent.click(button);
        const kind = tokenOf[label];
        expect(
          view.container.querySelector(`.mejiro-notation-overlay [data-token="${kind}"]`),
          `${dialect}: ${label}`,
        ).not.toBeNull();
        view.unmount();
      }
    }
  });

  it('applies the dialect to the live preview reader', () => {
    render(<MejiroManuscriptEditor chapters={chapters} dialect="narou" />);
    expect(readerMock.props?.dialect).toBe('narou');

    render(<MejiroManuscriptEditor chapters={chapters} />);
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
