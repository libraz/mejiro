import type { MejiroBook } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { useChapterLayout } from '@libraz/mejiro-vue';
import { defineComponent, h, type PropType, ref, shallowRef } from 'vue';

/** Hosts the Vue reading-position options printed in the re-flow section. */
export const ReflowReader = defineComponent({
  props: {
    book: { type: Object as PropType<MejiroBook>, required: true },
    epubBook: { type: Object as PropType<EpubBook>, required: true },
  },
  setup(props) {
    const book = props.book;
    const epub = shallowRef<EpubBook | null>(props.epubBook);
    const chapter = ref(0);
    const surface = ref<HTMLElement | null>(null);
    const spreadIdx = ref(0);
    // #region doc:vue
    // Vue: the same options; `layout.layout` is a Ref.
    const layout = useChapterLayout(book, epub, chapter, surface, {
      capturePosition: (l) => l.anchorAt(spreadIdx.value, 'right'),
      restorePosition: (l, anchor) => {
        spreadIdx.value = l.locateAnchor(anchor)?.spreadIdx ?? 0;
      },
    });
    // #endregion doc:vue
    return () =>
      h('div', { ref: surface }, layout.layout.value ? `spread ${spreadIdx.value}` : 'Loading');
  },
});
