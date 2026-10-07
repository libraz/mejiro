export { appendInlineNode, renderPageToDOM };

// #region doc:render-page
import { paragraphClassName, type RenderPage } from '@libraz/mejiro/render';

function renderPageToDOM(container: HTMLElement, page: RenderPage): void {
  container.replaceChildren();
  container.classList.add('mejiro-page');

  for (const paragraph of page.paragraphs) {
    const div = document.createElement('div');
    div.className = paragraphClassName(paragraph.kind, paragraph.headingLevel);
    // The heading size the layout measured, when it differs from the stylesheet default.
    if (paragraph.scale != null) {
      div.style.setProperty('--mejiro-paragraph-scale', String(paragraph.scale));
    }

    for (let li = 0; li < paragraph.lines.length; li++) {
      if (li > 0) div.appendChild(document.createElement('br'));
      for (const segment of paragraph.lines[li].segments) {
        appendInlineNode(div, segmentToInlineNode(segment));
      }
    }

    container.appendChild(div);
  }
}

// #endregion doc:render-page

// #region doc:inline-node
import { type InlineRenderNode, segmentToInlineNode } from '@libraz/mejiro/render';

function appendInlineNode(parent: Node, node: InlineRenderNode): void {
  if (node.type === 'text') {
    parent.appendChild(document.createTextNode(node.text));
    return;
  }
  const el = document.createElement(node.tag);
  if (node.className) el.className = node.className;
  if (node.href) el.setAttribute('href', node.href);
  if (node.title) el.title = node.title;
  for (const child of node.children) appendInlineNode(el, child);
  parent.appendChild(el);
}

// #endregion doc:inline-node
