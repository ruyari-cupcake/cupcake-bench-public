const COLOR = /^#[0-9a-f]{6}$/i;
const IMAGE = /^data:(image\/(?:png|jpeg|gif|webp));base64,[a-z0-9+/]+={0,2}$/i;
export const DEFAULT_THEME = Object.freeze({ background: '#fffaf2', foreground: '#302a25', bubble: '#f2e4d4', fontSize: 16 });

function demand(condition, message) { if (!condition) throw new Error(`Invalid document: ${message}`); }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function id(value) { return typeof value === 'string' && value.length > 0; }
function json(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { demand(Number.isFinite(value), 'non-finite number'); return; }
  demand(typeof value === 'object' && !ancestors.has(value), 'non-JSON value or cycle');
  demand(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, 'non-JSON object');
  ancestors.add(value);
  for (const item of Object.values(value)) json(item, ancestors);
  ancestors.delete(value);
}

export function validateDocument(value) {
  json(value);
  demand(record(value) && value.version === 2, 'version must be 2');
  demand(id(value.id) && typeof value.title === 'string', 'id/title');
  demand(Array.isArray(value.speakers) && Array.isArray(value.messages) && record(value.assets), 'collections');
  const speakerIds = new Set();
  for (const speaker of value.speakers) {
    demand(record(speaker) && id(speaker.id) && !speakerIds.has(speaker.id), 'speaker identity');
    demand(typeof speaker.name === 'string' && COLOR.test(speaker.color), 'speaker name/color');
    speakerIds.add(speaker.id);
  }
  for (const [key, asset] of Object.entries(value.assets)) {
    demand(id(key) && record(asset) && asset.id === key, 'asset identity');
    const match = typeof asset.data === 'string' && asset.data.match(IMAGE);
    demand(match && match[1].toLowerCase() === asset.mime, 'image data/mime');
  }
  const messageIds = new Set();
  for (const message of value.messages) {
    demand(record(message) && id(message.id) && !messageIds.has(message.id), 'message identity');
    demand(speakerIds.has(message.speakerId) && typeof message.text === 'string', 'message speaker/text');
    demand(Array.isArray(message.imageIds) && message.imageIds.every(key => typeof key === 'string' && Object.hasOwn(value.assets, key)), 'image references');
    messageIds.add(message.id);
  }
  demand(record(value.theme), 'theme');
  for (const key of ['background', 'foreground', 'bubble']) demand(typeof value.theme[key] === 'string' && COLOR.test(value.theme[key]), `theme ${key}`);
  demand(Number.isInteger(value.theme.fontSize) && value.theme.fontSize >= 10 && value.theme.fontSize <= 36, 'font size');
  // The document boundary owns a detached snapshot, including extension metadata.
  return structuredClone(value);
}

export function createDocument() {
  return { version: 2, id: 'logbook-demo', title: 'An evening conversation',
    speakers: [{ id: 's1', name: 'Mina', color: '#a05b45' }, { id: 's2', name: 'Noel', color: '#487a86' }],
    messages: [{ id: 'm1', speakerId: 's1', text: 'The lanterns are lit.', imageIds: [] },
      { id: 'm2', speakerId: 's2', text: 'Then let us begin.', imageIds: [] }],
    assets: {}, theme: { ...DEFAULT_THEME }, meta: { source: 'synthetic' } };
}

export function parseTranscript(text) {
  if (typeof text !== 'string') throw new Error('Transcript must be text');
  const doc = createDocument(); doc.speakers = []; doc.messages = [];
  const names = new Map();
  for (const line of text.replaceAll('\r\n', '\n').split('\n')) {
    const header = line.match(/^([^:\n]+):[ ]?(.*)$/);
    if (header && header[1].trim()) {
      const name = header[1].trim();
      if (!names.has(name)) {
        const speaker = { id: `s${names.size + 1}`, name, color: '#765643' };
        names.set(name, speaker.id); doc.speakers.push(speaker);
      }
      doc.messages.push({ id: `m${doc.messages.length + 1}`, speakerId: names.get(name), text: header[2], imageIds: [] });
    } else if (doc.messages.length) doc.messages.at(-1).text += `\n${line}`;
    else if (line.trim()) throw new Error('Transcript must begin with Name: text');
  }
  return validateDocument(doc);
}
