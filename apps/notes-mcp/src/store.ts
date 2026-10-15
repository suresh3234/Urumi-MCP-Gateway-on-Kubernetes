import crypto from 'crypto';
import { OrderNote } from './types';

export class NoteStore {
  private notes: Map<string, OrderNote> = new Map();

  constructor() {
    // Seed initial demo note
    this.addNote(12, 'Customer confirmed delivery address over chat verification.', false, 'AI Gateway');
  }

  public addNote(orderId: number, note: string, isCustomerNote: boolean = false, author: string = 'AI Agent'): OrderNote {
    const id = `note_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const entry: OrderNote = {
      id,
      orderId,
      note,
      isCustomerNote,
      author,
      createdAt: new Date().toISOString(),
    };

    this.notes.set(id, entry);
    return entry;
  }

  public getNotesForOrder(orderId: number): OrderNote[] {
    return Array.from(this.notes.values())
      .filter((n) => n.orderId === orderId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public searchNotes(query: string): OrderNote[] {
    const q = query.toLowerCase();
    return Array.from(this.notes.values()).filter(
      (n) => n.note.toLowerCase().includes(q) || String(n.orderId).includes(q) || n.author.toLowerCase().includes(q)
    );
  }

  public deleteNote(noteId: string): boolean {
    return this.notes.delete(noteId);
  }

  public getAllNotes(): OrderNote[] {
    return Array.from(this.notes.values());
  }

  public clear(): void {
    this.notes.clear();
  }
}
