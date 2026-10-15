import { NoteStore } from '../src/store';
import { AddOrderNoteSchema, ListOrderNotesSchema, SearchNotesSchema } from '../src/schemas';

describe('Notes MCP Store & Schemas Unit Tests', () => {
  let store: NoteStore;

  beforeEach(() => {
    store = new NoteStore();
  });

  it('adds and retrieves notes for a specific order ID', () => {
    const validated = AddOrderNoteSchema.parse({
      orderId: 100,
      note: 'Customer requested priority shipping.',
      isCustomerNote: true,
      author: 'Agent Alice',
    });

    const created = store.addNote(validated.orderId, validated.note, validated.isCustomerNote, validated.author);
    expect(created.id.startsWith('note_')).toBe(true);
    expect(created.orderId).toBe(100);
    expect(created.isCustomerNote).toBe(true);

    const notes = store.getNotesForOrder(100);
    expect(notes.length).toBe(1);
    expect(notes[0].note).toBe('Customer requested priority shipping.');
  });

  it('searches notes by keyword', () => {
    store.addNote(101, 'Urgent return request for size mismatch.', false, 'Agent Bob');
    store.addNote(102, 'Package dispatched via FedEx.', false, 'Warehouse');

    const searchRes = store.searchNotes('return');
    expect(searchRes.length).toBe(1);
    expect(searchRes[0].orderId).toBe(101);
  });

  it('deletes a note by ID', () => {
    const note = store.addNote(103, 'Temporary verification note', false);
    expect(store.deleteNote(note.id)).toBe(true);
    expect(store.getNotesForOrder(103).length).toBe(0);
  });
});
