import { validateDocument } from './document.js';
export const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export function renderPreview(value) {
  const doc = validateDocument(value), theme = doc.theme;
  const speakers = new Map(doc.speakers.map(speaker => [speaker.id, speaker]));
  return `<div class="transcript-preview" style="background:${theme.background};color:${theme.foreground};font-size:${theme.fontSize}px">${doc.messages.map(message => {
    const speaker = speakers.get(message.speakerId);
    return `<article data-message-id="${escapeHTML(message.id)}" style="background:${theme.bubble}"><strong style="color:${speaker.color}">${escapeHTML(speaker.name)}</strong><div class="message-body" style="white-space:pre-wrap">${escapeHTML(message.text)}</div>${message.imageIds.map(key => `<img alt="Attached image" src="${escapeHTML(doc.assets[key].data)}">`).join('')}</article>`;
  }).join('')}</div>`;
}
