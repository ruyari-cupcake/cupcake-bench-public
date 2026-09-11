import { parseTranscript } from './document.js';
import { loadDocument, saveDocument } from './storage.js';
import { importBundle, exportBundle } from './bundle.js';
import { renderPreview, escapeHTML } from './render.js';

export function mountEditor(session, storage) {
  const element = id => document.getElementById(id);
  const status = message => { element('status').textContent = message; };
  const attempt = operation => { try { operation(); } catch (error) { status(`Error: ${error.message}`); } };
  function refresh() {
    const doc = session.get(), active = document.activeElement;
    const focus = active?.closest('#editors') ? { label: active.getAttribute('aria-label'), start: active.selectionStart, end: active.selectionEnd } : null;
    if (active !== element('title')) element('title').value = doc.title;
    element('speakers').innerHTML = doc.speakers.map(speaker => `<label>${escapeHTML(speaker.name)}<input aria-label="Speaker ${escapeHTML(speaker.id)}" data-speaker="${escapeHTML(speaker.id)}" value="${escapeHTML(speaker.name)}"></label>`).join('');
    element('messages').innerHTML = doc.messages.map(message => `<label class="message-editor" data-message="${escapeHTML(message.id)}">${escapeHTML(message.id)}<textarea aria-label="Message ${escapeHTML(message.id)}" data-message-text="${escapeHTML(message.id)}">${escapeHTML(message.text)}</textarea></label>`).join('');
    element('preview').innerHTML = renderPreview(doc);
    if (focus) {
      const input = [...element('editors').querySelectorAll('[aria-label]')].find(node => node.getAttribute('aria-label') === focus.label);
      if (input) { input.focus(); input.setSelectionRange(focus.start, focus.end); }
    }
  }
  element('title').addEventListener('input', event => attempt(() => { const next = session.get(); next.title = event.target.value; session.commit(next); }));
  element('editors').addEventListener('input', event => attempt(() => {
    const next = session.get(), input = event.target;
    if (input.dataset.speaker) next.speakers.find(s => s.id === input.dataset.speaker).name = input.value;
    else if (input.dataset.messageText) next.messages.find(m => m.id === input.dataset.messageText).text = input.value;
    else return;
    session.commit(next);
  }));
  element('replace').onclick = () => attempt(() => { session.commit(parseTranscript(element('transcript').value)); status('Transcript imported'); });
  element('undo').onclick = () => { status(session.undo() ? 'Undone' : 'Nothing to undo'); };
  element('redo').onclick = () => { status(session.redo() ? 'Redone' : 'Nothing to redo'); };
  element('save').onclick = () => { const result = saveDocument(storage, session.get()); status(result.ok ? 'Saved' : `Error: ${result.error}`); };
  element('load').onclick = () => attempt(() => { const next = loadDocument(storage); if (next) { session.commit(next); status('Loaded'); } else status('No saved document'); });
  element('export').onclick = () => attempt(() => { element('bundle').value = exportBundle(session.get()); status('JSON exported'); });
  element('import').onclick = () => attempt(() => { session.commit(importBundle(element('bundle').value)); status('JSON imported'); });
  session.subscribe(refresh); refresh();
  return { refresh, status, attempt };
}
