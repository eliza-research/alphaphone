/** Keep the shared shell slots while rendering only a production template leaf. */
export function prototypeLeafTemplate(fragment) {
  return `<div class="os"><div data-screen="1">
    <sc-if value="{{false}}"><sc-element value="{{homeShell}}"><sc-slot name="header"></sc-slot><sc-slot name="cards"></sc-slot></sc-element></sc-if>
    <div data-alpha-layer="app">${fragment}</div>
    <sc-if value="{{false}}"><div data-alpha-layer="conversation"></div></sc-if>
  </div></div>`;
}
