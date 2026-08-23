/**
 * @vitest-environment happy-dom
 */
import path from 'node:path';
import JSZip from 'jszip';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type { AssetResolverAsset, AssetResolverRequest } from '../../src/epub/editor.js';
import { EditableEpub, EpubProject } from '../../src/epub/index.js';

/**
 * Names of the shapes `AssetResolverRequest.asset` is declared to accept, read
 * back from the sources through the type checker so an alias is followed.
 *
 * The runtime checks below cannot see an annotation that is merely too narrow,
 * so the declaration itself is pinned here.
 */
function declaredAssetVariants(): string[] {
  const entry = path.join(process.cwd(), 'packages/mejiro/src/epub/editor.ts');
  const program = ts.createProgram([entry], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    strict: true,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entry);
  if (!source) throw new Error(`source not found: ${entry}`);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error('editor.ts exports nothing');
  const request = checker
    .getExportsOfModule(moduleSymbol)
    .find((symbol) => symbol.getName() === 'AssetResolverRequest');
  if (!request) throw new Error('AssetResolverRequest is not exported');
  const asset = checker.getPropertyOfType(checker.getDeclaredTypeOfSymbol(request), 'asset');
  const declaration = asset?.valueDeclaration ?? asset?.getDeclarations()?.[0];
  if (!(asset && declaration)) throw new Error('AssetResolverRequest has no `asset` member');
  const type = checker.getTypeOfSymbolAtLocation(asset, declaration);
  const members = type.isUnion() ? type.types : [type];
  return members.map((member) => checker.typeToString(member)).sort();
}

async function makeEpub(files: Record<string, string | Uint8Array>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const [path, contents] of Object.entries(files)) {
    zip.file(path, contents);
  }
  return zip.generateAsync({ type: 'arraybuffer' });
}

const containerXml = `<?xml version="1.0"?>
<container>
  <rootfiles>
    <rootfile full-path="OPS/package.opf" />
  </rootfiles>
</container>`;

const opfXml = `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>解決テスト</dc:title>
  </metadata>
  <manifest>
    <item id="c1" href="Text/chapter.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine>
    <itemref idref="c1" />
  </spine>
</package>`;

/**
 * Runtime counterpart of the declared {@link AssetResolverAsset} union: an
 * object is a member only if it carries the required naming field of one of the
 * two variants, plus the optional fields both share.
 */
function conformsToAssetResolverAsset(asset: AssetResolverAsset): boolean {
  const value = asset as Record<string, unknown>;
  const isEditableImageAsset = typeof value.filename === 'string';
  const isProjectAsset = typeof value.href === 'string';
  if (!(isEditableImageAsset || isProjectAsset)) return false;
  if (value.mediaType !== undefined && typeof value.mediaType !== 'string') return false;
  if (value.url !== undefined && typeof value.url !== 'string') return false;
  return value.data === undefined || value.data instanceof Uint8Array
    ? true
    : value.data instanceof ArrayBuffer;
}

describe('AssetResolverRequest.asset across both export paths', () => {
  it('declares both variants the export pipelines actually pass', () => {
    expect(declaredAssetVariants()).toEqual(['EditableImageAsset', 'EpubProjectAsset']);
  });

  it('hands the editable path an asset that matches the declared union', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>`,
    });
    const editor = await EditableEpub.load(data);
    editor.addImage(0, {
      filename: 'remote.png',
      mediaType: 'image/png',
      url: 'https://cdn.example.com/remote.png',
    });

    const seen: AssetResolverRequest[] = [];
    await editor.export({
      assetResolver(request) {
        seen.push(request);
        return new Uint8Array([1, 2, 3]);
      },
    });

    expect(seen).toHaveLength(1);
    const asset = seen[0].asset;
    expect(conformsToAssetResolverAsset(asset)).toBe(true);
    // The editable variant is the one that names its file, not its ZIP path.
    expect('filename' in asset).toBe(true);
    if (!('filename' in asset)) throw new Error('expected an editable image asset');
    expect(asset.filename).toBe('remote.png');
    expect(asset.url).toBe('https://cdn.example.com/remote.png');
    expect(seen[0].assetKey).toBe('remote.png');
  });

  it('hands the project path an asset that matches the declared union', async () => {
    const project = EpubProject.fromManuscript({
      metadata: { title: '遠隔素材', identifier: 'urn:uuid:asset-union' },
      chapters: [{ title: '一', body: '本文' }],
    });
    project.addAsset({
      href: 'OPS/Images/remote.png',
      mediaType: 'image/png',
      url: 'https://cdn.example.com/project.png',
    });

    const seen: AssetResolverRequest[] = [];
    await project.export({
      assetResolver(request) {
        seen.push(request);
        return new Uint8Array([4, 5, 6]);
      },
    });

    expect(seen).toHaveLength(1);
    const asset = seen[0].asset;
    expect(conformsToAssetResolverAsset(asset)).toBe(true);
    // The project variant names its ZIP path and carries no `filename`, which
    // is exactly what the former `EditableImageAsset` annotation claimed.
    expect('filename' in asset).toBe(false);
    if (!('href' in asset)) throw new Error('expected a project asset');
    expect(asset.href).toBe('OPS/Images/remote.png');
    expect(asset.url).toBe('https://cdn.example.com/project.png');
    expect(seen[0].assetKey).toBe('OPS/Images/remote.png');
  });

  it('accepts one resolver written against the union on both paths', async () => {
    // A host writes the resolver once and passes it to both entry points; this
    // is the shape that failed to type-check while `asset` claimed to always be
    // an `EditableImageAsset`.
    const names: string[] = [];
    const resolver = (request: AssetResolverRequest): Uint8Array => {
      const { asset } = request;
      names.push('filename' in asset ? asset.filename : asset.href);
      return new Uint8Array([9]);
    };

    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>`,
    });
    const editor = await EditableEpub.load(data);
    editor.addImage(0, { filename: 'shared.png', url: 'https://cdn.example.com/shared.png' });
    await editor.export({ assetResolver: resolver });

    const project = EpubProject.fromManuscript({
      metadata: { title: '共有', identifier: 'urn:uuid:shared-resolver' },
      chapters: [{ title: '一', body: '本文' }],
    });
    project.addAsset({ href: 'OPS/Images/shared.png', url: 'https://cdn.example.com/shared.png' });
    await project.export({ assetResolver: resolver });

    expect(names).toEqual(['shared.png', 'OPS/Images/shared.png']);
  });
});
