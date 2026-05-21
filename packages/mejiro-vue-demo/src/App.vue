<script setup lang="ts">
import { formatDialogueLineBreaks } from '@libraz/mejiro';
import { DEFAULT_HEADING_STYLES } from '@libraz/mejiro/book';
import type { InlineAnnotation } from '@libraz/mejiro/browser';
import type { EpubProjectChapterDraft, MejiroChapterNavMode } from '@libraz/mejiro-vue';
import {
  MejiroNotationHighlighter,
  MejiroReader,
  useEditableEpub,
  useEpubProject,
  useManuscriptDraft,
} from '@libraz/mejiro-vue';
import { computed, onMounted, ref, watch } from 'vue';

const FONTS = [
  { value: "'Shippori Mincho', serif", label: 'Shippori Mincho' },
  { value: "'Noto Serif JP', serif", label: 'Noto Serif JP' },
  { value: "'Zen Kaku Gothic New', sans-serif", label: 'Zen Kaku Gothic New' },
  { value: 'serif', label: 'System Serif' },
];

const options = {
  fontFamily: FONTS[0].value,
  fontSize: 16,
  lineSpacing: 1.9,
  headingStyles: DEFAULT_HEADING_STYLES,
};

type DemoMode = 'viewer' | 'create' | 'edit' | 'custom';
const demoModes: DemoMode[] = ['viewer', 'create', 'edit', 'custom'];
const mode = ref<DemoMode>('viewer');

const customDraft = useManuscriptDraft({
  initialChapters: [
    {
      id: 'custom-1',
      title: '第一話',
      body:
        '｜縦書き《たてがき》は、漢字とかな、そして《《圏点》》までを一行に同居させたい体裁です。\n\n' +
        '〔20〕世紀の小説投稿サイトでは、原稿はテキストで貼り、組版は読み手側に委ねるのが普通でした。\n\n' +
        'いまや *em* も **strong** も [リンク](https://example.com) も、原稿の段階で見えるべきです。',
    },
    { id: 'custom-2', title: '第二話', body: '次の章の本文をここに書きます。' },
  ],
});
const customChapters = customDraft.chapters;
const customSelected = customDraft.selected;
const customManuscript = computed(() =>
  customChapters.value.map((chapter) => ({
    id: chapter.id,
    title: chapter.title,
    body: chapter.body,
  })),
);
const customCurrentBody = computed(() => customChapters.value[customSelected.value]?.body ?? '');
const customCurrentTitle = computed(() => customChapters.value[customSelected.value]?.title ?? '');

const enableChapterNav = ref(true);
const enableHeader = ref(true);
const enableDropZone = ref(true);
const enableSettings = ref(true);
const enableImageOverlay = ref(true);
const enableStats = ref(true);
const enableKeyboard = ref(true);
const enablePageIndicator = ref(true);
const chapterNavMode = ref<MejiroChapterNavMode>('panel');
const chapterNavModes: MejiroChapterNavMode[] = ['select', 'panel', 'both', 'none'];

const chromeOptions = [
  { key: 'enableHeader', model: enableHeader },
  { key: 'enableDropZone', model: enableDropZone },
  { key: 'enableChapterNav', model: enableChapterNav },
  { key: 'enableSettings', model: enableSettings },
  { key: 'enableImageOverlay', model: enableImageOverlay },
  { key: 'enableStats', model: enableStats },
  { key: 'enableKeyboard', model: enableKeyboard },
  { key: 'enablePageIndicator', model: enablePageIndicator },
];

const headerDependentOptions = ['enableSettings', 'enableImageOverlay', 'enableStats'];
const effectiveChapterNavMode = computed<MejiroChapterNavMode>(() => {
  if (!enableChapterNav.value) return 'none';
  if (!enableHeader.value && chapterNavMode.value === 'select') return 'none';
  if (!enableHeader.value && chapterNavMode.value === 'both') return 'panel';
  return chapterNavMode.value;
});
const modeDisabled = (nextMode: MejiroChapterNavMode) =>
  !enableChapterNav.value ||
  (!enableHeader.value && (nextMode === 'select' || nextMode === 'both'));

const defaultBody = `これは｜漢字《かんじ》のルビ例です。

小説投稿サイトから貼り付けた原稿を章に分け、EPUBとして整理します。`;

function defaultChapter(index = 0): EpubProjectChapterDraft {
  return {
    id: `chapter-${Date.now()}-${index}`,
    title: index === 0 ? '第一話' : `第${index + 1}話`,
    body: index === 0 ? defaultBody : '',
  };
}

const project = useEpubProject({
  metadata: { title: '新しい作品', author: '作者名' },
  chapters: [defaultChapter()],
});
const projectMetadata = project.metadata;
const projectChapters = project.chapters;
const projectSelectedChapter = project.selectedChapter;
const projectCurrentChapter = project.currentChapter;
const projectPreviewError = project.previewError;
const projectPreviewing = project.previewing;

const editable = useEditableEpub();
const editableEditor = editable.editor;
const editableLoading = editable.loading;
const editableError = editable.error;
const editableSelection = editable.selection;
const editText = ref('');
const rubyStart = ref(0);
const rubyEnd = ref(0);
const rubyText = ref('');
const imageInput = ref<HTMLInputElement | null>(null);
const editTextarea = ref<HTMLTextAreaElement | null>(null);
const paragraphFilter = ref('');
const editBook = editable.book;
const editChapter = computed(
  () => editBook.value?.chapters[editableSelection.value.chapter] ?? null,
);
const editParagraph = editable.selectedParagraph;
const selectedEditChapter = computed(() => editableSelection.value.chapter);
const filteredParagraphs = computed(() => {
  const query = paragraphFilter.value.trim();
  if (!editChapter.value) return [];
  return editChapter.value.paragraphs
    .map((paragraph, paragraphIndex) => ({ paragraph, paragraphIndex }))
    .filter(({ paragraph }) => !query || paragraph.text.includes(query));
});
const previewBook = computed(() =>
  mode.value === 'create'
    ? project.previewBook.value
    : mode.value === 'edit'
      ? editable.previewBook.value
      : null,
);
const previewChapter = computed(() =>
  mode.value === 'create'
    ? Math.min(
        projectSelectedChapter.value,
        Math.max(0, (previewBook.value?.chapters.length ?? 1) - 1),
      )
    : mode.value === 'edit'
      ? selectedEditChapter.value
      : undefined,
);

watch(editParagraph, (paragraph) => {
  editText.value = paragraph?.text ?? '';
  rubyStart.value = 0;
  rubyEnd.value = 0;
  rubyText.value = '';
});

onMounted(() => {
  void editable.loadUrl('/neko.epub');
});

function downloadEpub(buffer: ArrayBuffer, title: string): void {
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/epub+zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title || 'book'}.epub`;
  a.click();
  URL.revokeObjectURL(url);
}

function updateEditText(nextText: string): void {
  editText.value = nextText;
  editable.updateParagraph(nextText);
}

function codePointIndexAtOffset(text: string, offset: number): number {
  return [...text.slice(0, offset)].length;
}

function syncRubySelection(el: HTMLTextAreaElement): void {
  const start = codePointIndexAtOffset(el.value, el.selectionStart);
  const end = codePointIndexAtOffset(el.value, el.selectionEnd);
  rubyStart.value = Math.min(start, end);
  rubyEnd.value = Math.max(start, end);
}

function applyRuby(): void {
  if (!(editParagraph.value && rubyText.value.trim())) return;
  const len = [...editText.value].length;
  const start = Math.max(0, Math.min(rubyStart.value, len));
  const end = Math.max(start, Math.min(rubyEnd.value, len));
  if (end <= start) return;
  const nextInline: InlineAnnotation[] = [
    ...editParagraph.value.inlineAnnotations.filter(
      (ann) => ann.endIndex <= start || ann.startIndex >= end,
    ),
    {
      kind: 'ruby',
      startIndex: start,
      endIndex: end,
      rubyText: rubyText.value.trim(),
      type: end - start === 1 ? ('mono' as const) : ('group' as const),
    },
  ].sort((a, b) => a.startIndex - b.startIndex);
  editable.updateParagraph(editText.value, nextInline);
  rubyText.value = '';
}

function adjustDialogueLineBreaks(): void {
  updateEditText(formatDialogueLineBreaks(editText.value));
}

function setEditSelection(chapter: number, paragraph: number): void {
  editable.setSelection({ chapter, paragraph });
}

async function addImage(file: File): Promise<void> {
  if (!editChapter.value) return;
  editable.addImage({
    filename: file.name,
    mediaType: file.type || 'application/octet-stream',
    data: await file.arrayBuffer(),
    alt: file.name,
    afterBlockId: paragraphBlockId(editChapter.value, editableSelection.value.paragraph),
  });
}

function paragraphBlockId(
  chapter: NonNullable<typeof editBook.value>['chapters'][number],
  paragraphIndex: number,
): string | undefined {
  let current = 0;
  for (const block of chapter.blocks) {
    if (block.kind !== 'paragraph') continue;
    if (current === paragraphIndex) return block.id;
    current++;
  }
  return undefined;
}

function setPreviewChapter(nextChapter: number): void {
  if (mode.value === 'create') {
    project.setSelectedChapter(nextChapter);
    return;
  }
  if (mode.value === 'edit') {
    setEditSelection(nextChapter, 0);
  }
}
</script>

<template>
  <div class="demo-shell">
    <main class="demo-preview">
      <MejiroReader
        v-if="mode === 'viewer'"
        key="viewer"
        :options="options"
        :fonts="FONTS"
        epub-url="/neko.epub"
        subtitle="Vue Viewer"
        :enable-header="enableHeader"
        :enable-drop-zone="enableDropZone"
        :enable-chapter-nav="enableChapterNav"
        :chapter-nav-mode="effectiveChapterNavMode"
        :enable-settings="enableHeader && enableSettings"
        :enable-image-overlay="enableHeader && enableImageOverlay"
        :enable-stats="enableHeader && enableStats"
        :enable-keyboard="enableKeyboard"
        :enable-page-indicator="enablePageIndicator"
      />
      <MejiroReader
        v-else-if="mode === 'custom'"
        key="custom"
        :options="options"
        :fonts="FONTS"
        subtitle="Custom Editor Preview"
        chapter-nav-mode="panel"
        :manuscript="customManuscript"
        :chapter="customSelected"
        :enable-image-overlay="false"
        @chapter-change="customDraft.setSelected"
      />
      <MejiroReader
        v-else-if="previewBook"
        :key="mode"
        :options="options"
        :fonts="FONTS"
        :epub="previewBook"
        :chapter="previewChapter"
        :subtitle="mode === 'create' ? 'Create Preview' : 'Edit Preview'"
        chapter-nav-mode="panel"
        :enable-image-overlay="false"
        @chapter-change="setPreviewChapter"
      />
      <div v-else class="demo-empty">Loading preview...</div>
    </main>

    <aside class="demo-options" aria-label="Demo options">
      <div class="demo-tabs" role="tablist" aria-label="Demo modes">
        <button
          v-for="tab in demoModes"
          :key="tab"
          type="button"
          :class="{ 'is-active': mode === tab }"
          @click="mode = tab"
        >
          {{ tab }}
        </button>
      </div>

      <template v-if="mode === 'viewer'">
        <div class="demo-options-head">
          <span>Reader props</span>
          <strong>Built-in chrome</strong>
        </div>
        <div class="demo-toggle-grid">
          <label
            v-for="option in chromeOptions"
            :key="option.key"
            class="demo-toggle"
            :class="{ 'is-disabled': headerDependentOptions.includes(option.key) && !enableHeader }"
          >
            <input
              v-model="option.model.value"
              type="checkbox"
              :disabled="headerDependentOptions.includes(option.key) && !enableHeader"
            />
            <span>{{ option.key }}</span>
          </label>
        </div>
        <div class="demo-option-group">
          <span class="demo-option-label">chapterNavMode</span>
          <div class="demo-segments">
            <button
              v-for="navMode in chapterNavModes"
              :key="navMode"
              type="button"
              :class="{ 'is-active': chapterNavMode === navMode }"
              :disabled="modeDisabled(navMode)"
              @click="chapterNavMode = navMode"
            >
              {{ navMode }}
            </button>
          </div>
        </div>
        <pre>&lt;MejiroReader
  :enable-header="{{ enableHeader }}"
  :enable-drop-zone="{{ enableDropZone }}"
  :enable-chapter-nav="{{ enableChapterNav }}"
  chapter-nav-mode="{{ effectiveChapterNavMode }}"
  :enable-settings="{{ enableHeader && enableSettings }}"
  :enable-image-overlay="{{ enableHeader && enableImageOverlay }}"
  :enable-stats="{{ enableHeader && enableStats }}"
  :enable-keyboard="{{ enableKeyboard }}"
  :enable-page-indicator="{{ enablePageIndicator }}"
/&gt;</pre>
      </template>

      <template v-if="mode === 'create'">
        <div class="demo-options-head">
          <span>New EPUB</span>
          <strong>Manuscript workspace</strong>
        </div>
        <div class="demo-form">
          <label>
            <span>Title</span>
            <input
              :value="projectMetadata.title"
              @input="project.setMetadata({ title: ($event.target as HTMLInputElement).value })"
            />
          </label>
          <label>
            <span>Author</span>
            <input
              :value="projectMetadata.author ?? ''"
              @input="project.setMetadata({ author: ($event.target as HTMLInputElement).value })"
            />
          </label>
        </div>
        <div class="mejiro-editor-section">
          <div class="demo-section-title">
            <span class="demo-option-label">Chapters</span>
            <small>{{ projectChapters.length }} items</small>
          </div>
          <div class="mejiro-editor-paragraphs demo-list">
            <button
              v-for="(chapter, index) in projectChapters"
              :key="chapter.id"
              type="button"
              :class="{ 'is-active': projectSelectedChapter === index }"
              @click="project.setSelectedChapter(index)"
            >
              <span>Chapter {{ index + 1 }}</span>
              <strong>{{ chapter.title || 'Untitled' }}</strong>
            </button>
          </div>
          <div class="demo-action-row">
            <button type="button" @click="project.addChapter()">Add chapter</button>
            <button type="button" @click="project.removeChapter()">Remove</button>
          </div>
        </div>
        <div v-if="projectCurrentChapter" class="demo-form">
          <label>
            <span>Chapter title</span>
            <input
              :value="projectCurrentChapter.title"
              @input="
                project.patchChapter(projectSelectedChapter, {
                  title: ($event.target as HTMLInputElement).value,
                })
              "
            />
          </label>
          <label>
            <span>Draft</span>
            <textarea
              class="demo-manuscript"
              :value="projectCurrentChapter.body"
              @input="
                project.patchChapter(projectSelectedChapter, {
                  body: ($event.target as HTMLTextAreaElement).value,
                })
              "
            />
          </label>
        </div>
        <div v-if="projectPreviewError" class="demo-error">
          {{ projectPreviewError.message }}
        </div>
        <button
          type="button"
          class="mejiro-editor-export"
          @click="
            project
              .exportEpub()
              .then((buffer) => downloadEpub(buffer, projectMetadata.title))
          "
        >
          Export EPUB{{ projectPreviewing ? ' (previewing)' : '' }}
        </button>
      </template>

      <template v-if="mode === 'edit'">
        <div class="demo-options-head">
          <span>Existing EPUB</span>
          <strong>{{ editableEditor?.title ?? 'Loading sample' }}</strong>
          <small v-if="editableEditor?.author">{{ editableEditor.author }}</small>
        </div>
        <template v-if="editBook">
          <div class="mejiro-editor-section">
            <div class="demo-section-title">
              <span class="demo-option-label">Chapter</span>
              <small>{{ editBook.chapters[selectedEditChapter]?.paragraphs.length ?? 0 }} paragraphs</small>
            </div>
            <select
              class="demo-select"
              :value="selectedEditChapter"
              @change="
                setEditSelection(Number(($event.target as HTMLSelectElement).value), 0)
              "
            >
              <option
                v-for="(chapter, chapterIndex) in editBook.chapters"
                :key="chapter.href"
                :value="chapterIndex"
              >
                {{ chapter.title ?? `Chapter ${chapterIndex + 1}` }}
              </option>
            </select>
            <input v-model="paragraphFilter" class="demo-search" placeholder="Filter paragraphs" />
            <div class="mejiro-editor-paragraphs demo-list demo-list-compact">
              <button
                v-for="{ paragraph, paragraphIndex } in filteredParagraphs"
                :key="`${editChapter?.href}-${paragraphIndex}`"
                type="button"
                :class="{ 'is-active': editableSelection.paragraph === paragraphIndex }"
                @click="
                  setEditSelection(selectedEditChapter, paragraphIndex)
                "
              >
                <span>Paragraph {{ paragraphIndex + 1 }}</span>
                <strong>{{ paragraph.text.slice(0, 56) }}</strong>
              </button>
            </div>
          </div>
          <div class="demo-form">
            <label>
              <span>Proofread</span>
              <textarea
                ref="editTextarea"
                :value="editText"
                @input="updateEditText(($event.target as HTMLTextAreaElement).value)"
                @select="syncRubySelection($event.target as HTMLTextAreaElement)"
              />
            </label>
            <div class="demo-sync-note">Preview updates automatically.</div>
            <button type="button" class="mejiro-editor-primary" @click="adjustDialogueLineBreaks">
              Adjust dialogue line breaks
            </button>
          </div>
          <div class="mejiro-editor-section">
            <span class="demo-option-label">Furigana</span>
            <div class="demo-ruby-target">
              {{
                rubyEnd > rubyStart
                  ? [...editText].slice(rubyStart, rubyEnd).join('')
                  : 'Select text in the proofread field'
              }}
            </div>
            <input v-model="rubyText" placeholder="よみがな" />
            <button type="button" class="mejiro-editor-primary" @click="applyRuby">
              Add furigana to selection
            </button>
          </div>
          <div class="mejiro-editor-section">
            <span class="demo-option-label">Images</span>
            <button type="button" @click="imageInput?.click()">Insert image after paragraph</button>
            <input
              ref="imageInput"
              type="file"
              accept="image/*"
              hidden
              @change="
                ($event.target as HTMLInputElement).files?.[0] &&
                  addImage(($event.target as HTMLInputElement).files![0])
              "
            />
          </div>
          <button
            type="button"
            class="mejiro-editor-export"
            @click="
              editable
                .exportEpub()
                .then(
                  (buffer) =>
                    buffer && downloadEpub(buffer, editableEditor?.title || 'edited'),
                )
            "
          >
            Export EPUB
          </button>
        </template>
        <div v-if="editableLoading" class="demo-empty">Loading editor...</div>
        <div v-if="editableError" class="demo-error">{{ editableError.message }}</div>
      </template>

      <template v-if="mode === 'custom'">
        <div class="demo-options-head">
          <span>Fully custom editor</span>
          <strong>
            useManuscriptDraft + MejiroReader (manuscript source) + MejiroNotationHighlighter
          </strong>
          <small>
            Skips the EPUB round-trip entirely — the Reader on the left is driven straight from
            the chapter array on the right.
          </small>
        </div>
        <div class="mejiro-editor-section">
          <span class="demo-option-label">Chapters</span>
          <div class="mejiro-editor-paragraphs demo-list demo-list-compact">
            <button
              v-for="(chapter, index) in customChapters"
              :key="chapter.id"
              type="button"
              :class="{ 'is-active': customSelected === index }"
              @click="customDraft.setSelected(index)"
            >
              <span>{{ `#${index + 1}` }}</span>
              <strong>{{ chapter.title || 'Untitled' }}</strong>
            </button>
          </div>
          <div class="demo-button-row">
            <button
              type="button"
              @click="customDraft.addChapter({ title: `第${customChapters.length + 1}話` })"
            >
              Add chapter
            </button>
            <button type="button" @click="customDraft.removeChapter(customSelected)">
              Remove
            </button>
          </div>
        </div>
        <div class="mejiro-editor-section">
          <span class="demo-option-label">Chapter title</span>
          <input
            class="demo-search"
            :value="customCurrentTitle"
            @input="
              customDraft.patchChapter(customSelected, {
                title: ($event.target as HTMLInputElement).value,
              })
            "
          />
          <span class="demo-option-label">Body (with notation highlight)</span>
          <MejiroNotationHighlighter
            :model-value="customCurrentBody"
            dialect="mejiro"
            @update:model-value="(next: string) => customDraft.patchChapter(customSelected, { body: next })"
          />
        </div>
      </template>
    </aside>
  </div>
</template>
