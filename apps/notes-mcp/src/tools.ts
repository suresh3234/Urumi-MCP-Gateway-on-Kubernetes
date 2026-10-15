import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { NoteStore } from './store';
import { AddOrderNoteSchema, ListOrderNotesSchema, SearchNotesSchema, DeleteOrderNoteSchema } from './schemas';

export function registerNotesTools(server: McpServer, store: NoteStore): void {
  // 1. Add Order Note
  server.tool(
    'add_order_note',
    'Add an internal or customer-facing note associated with a WooCommerce order.',
    {
      orderId: z.number().int().describe('Order ID to attach note to'),
      note: z.string().describe('Note content or commentary'),
      isCustomerNote: z.boolean().optional().describe('Whether the note is visible to the customer'),
      author: z.string().optional().describe('Author name of the note'),
    },
    async (args) => {
      try {
        const validated = AddOrderNoteSchema.parse(args);
        const created = store.addNote(validated.orderId, validated.note, validated.isCustomerNote, validated.author);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  message: `Note added to Order #${validated.orderId} successfully.`,
                  note: created,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: true, message: err.message }) }],
          isError: true,
        };
      }
    }
  );

  // 2. List Order Notes
  server.tool(
    'list_order_notes',
    'Retrieve all internal and customer notes for a specific order ID.',
    {
      orderId: z.number().int().describe('Order ID to fetch notes for'),
    },
    async (args) => {
      try {
        const validated = ListOrderNotesSchema.parse(args);
        const notes = store.getNotesForOrder(validated.orderId);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  orderId: validated.orderId,
                  count: notes.length,
                  notes,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: true, message: err.message }) }],
          isError: true,
        };
      }
    }
  );

  // 3. Search Notes
  server.tool(
    'search_notes',
    'Search notes across all orders by keyword, author, or order ID.',
    {
      query: z.string().describe('Search keyword or order ID'),
    },
    async (args) => {
      try {
        const validated = SearchNotesSchema.parse(args);
        const matches = store.searchNotes(validated.query);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  query: validated.query,
                  count: matches.length,
                  notes: matches,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: true, message: err.message }) }],
          isError: true,
        };
      }
    }
  );

  // 4. Delete Order Note
  server.tool(
    'delete_order_note',
    'Delete a specific order note by its unique note ID.',
    {
      noteId: z.string().describe('Unique ID of the note to delete'),
    },
    async (args) => {
      try {
        const validated = DeleteOrderNoteSchema.parse(args);
        const deleted = store.deleteNote(validated.noteId);

        if (!deleted) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: true, message: `Note ID '${validated.noteId}' not found.` }) }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ message: `Note '${validated.noteId}' deleted successfully.` }, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: true, message: err.message }) }],
          isError: true,
        };
      }
    }
  );
}
