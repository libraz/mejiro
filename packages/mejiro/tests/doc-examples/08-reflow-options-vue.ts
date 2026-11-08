import type { MejiroBook } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { useChapterLayout } from '@libraz/mejiro-vue';
import { defineComponent, h, type PropType, ref, shallowRef } from 'vue';

/** Hosts the Vue reading-position options printed in the re-flow section. */
export const ReflowReader = defineComponent({
  props: {
    book: { type: Object as PropType<MejiroBook>, required: true },
    epub: { type: Object as PropType<EpubBook>, required: true },
  },
  setup(props) {
    const book = props.book;
    const epub = shallowRef<EpubBook | null>(props.epub);
    const chapterIndex = ref(0);
    const surface = ref<HTMLElement | null>(null);
    const spreadIndex = ref(0);
    // #region doc:vue
    // Vue: the same options, which also take Refs; `layout.layout` is a Ref.
    const layout = useChapterLayout(book, {
      epub,
      chapterIndex,
      surface,
      capturePosition: (l) => l.anchorAt(spreadIndex.value),
      restorePosition: (l, anchor) => {
        spreadIndex.value = l.locateAnchor(anchor)?.spreadIndex ?? 0;
      },
    });
    // #endregion doc:vue
    return () =>
      h('div', { ref: surface }, layout.layout.value ? `spread ${spreadIndex.value}` : 'Loading');
  },
});
