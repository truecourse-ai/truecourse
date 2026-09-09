/** Isolated browser fixture: every run owns its in-memory ledger. */
export type ExpenseDefect = 'cancel' | 'cancel-submits' | 'date-default' | 'category-default' | 'total' | 'save-closure' | 'announcement' | 'pagination' | 'filters' | 'primary-order' | 'tie-order' | 'details' | 'empty-notes'

export function expenseFixture(defect?: ExpenseDefect, empty = false): string {
  return `<!doctype html><html><body>
    <h1>Your expenses</h1><p id="total"></p>
    <label>Category filter<select id="filter"><option value="all">All categories</option><option value="travel">Transport</option></select></label>
    <button id="next">Next page</button><p id="page"></p><button id="add">Add expense</button>
    <div role="status" aria-label="Notifications" id="announcement"></div>
    <section id="list"><table aria-label="Expenses"><tbody id="rows"></tbody></table></section>
    <section id="details" hidden></section>
    <form role="dialog" aria-label="Add expense" id="dialog" hidden>
      <label>Description<input id="description" required></label>
      <label>Amount<input id="amount" type="number" step="0.01" min="0.01" required></label>
      <label>Expense date<input id="date" type="date" required></label>
      <label for="category">Category</label><select id="category"><option value="travel">Transport</option><option value="food">Food</option></select>
      <label for="notes">Notes</label><textarea id="notes"></textarea>
      <button id="cancel" type="button">Cancel</button><button id="save" type="submit">Save expense</button>
    </form>
    <script>
      (() => {
      const defect = ${JSON.stringify(defect ?? '')};
      const ledger = ${JSON.stringify(empty ? [] : [
        { id: 1, description: 'Recent', amount: 5, date: '2100-01-01', category: 'travel', notes: 'Train travel' },
        { id: 2, description: 'Tie second', amount: 10.25, date: '2099-12-31', category: 'travel', notes: '' },
        { id: 3, description: 'Tie first', amount: 20.50, date: '2099-12-31', category: 'travel', notes: 'Taxi' },
        { id: 4, description: 'Historical', amount: 6, date: '2099-01-01', category: 'travel', notes: '' },
      ])};
      const byId = id => document.getElementById(id);
      let currentPage = 1;
      function render() {
        byId('total').textContent = 'Overall total: $' + (ledger.reduce((sum, item) => sum + item.amount, 0) + (defect === 'total' ? 1 : 0)).toFixed(2);
        byId('page').textContent = 'Page ' + currentPage;
        const sorted = [...ledger].sort((a, b) => (defect === 'primary-order' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)) || (defect === 'tie-order' ? a.id - b.id : b.id - a.id));
        byId('rows').replaceChildren();
        for (const item of sorted.slice((currentPage - 1) * 3, currentPage * 3)) {
          const row = document.createElement('tr');
          const cell = document.createElement('td');
          const title = document.createElement('a'); title.href = '#details'; title.textContent = item.description; title.onclick = () => showDetails(item);
          const view = document.createElement('a'); view.href = '#details'; view.textContent = 'View'; view.setAttribute('aria-label', 'View expense: ' + item.description); view.onclick = () => showDetails(item);
          cell.append(title, ' | $' + item.amount.toFixed(2) + ' | ' + item.date + ' | ', view); row.append(cell); byId('rows').append(row);
        }
      }
      function showDetails(item) {
        byId('list').hidden = true; byId('details').hidden = false;
        byId('details').textContent = 'Description: ' + item.description + ' | Amount: $' + (defect === 'details' ? 0 : item.amount).toFixed(2) + ' | Date: ' + item.date + ' | Category: Transport | Notes: ' + (item.notes || (defect === 'empty-notes' ? '' : 'No notes added.'));
        const back = document.createElement('button'); back.textContent = 'Back to expenses'; back.onclick = () => { byId('details').hidden = true; byId('list').hidden = false; }; byId('details').append(back);
      }
      byId('next').onclick = () => { currentPage = 2; render(); };
      byId('add').onclick = () => {
        byId('dialog').hidden = false; byId('description').value = ''; byId('amount').value = ''; byId('notes').value = '';
        const now = new Date(); byId('date').value = defect === 'date-default' ? '1999-01-01' : now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        byId('category').value = defect === 'category-default' ? 'food' : 'travel';
      };
      byId('cancel').onclick = () => {
        // A broken handler can accidentally submit and then close the dialog.
        // Native validation masks this bug when the test leaves amount blank.
        if (defect === 'cancel-submits') byId('dialog').requestSubmit();
        if (defect !== 'cancel') byId('dialog').hidden = true;
      };
      byId('dialog').onsubmit = event => {
        event.preventDefault();
        ledger.push({ id: 5, description: byId('description').value, amount: Number(byId('amount').value), date: byId('date').value, category: byId('category').value, notes: byId('notes').value });
        if (defect !== 'save-closure') byId('dialog').hidden = true;
        if (defect !== 'announcement') byId('announcement').textContent = 'Expense added.';
        if (defect !== 'pagination') currentPage = 1;
        if (defect === 'filters') byId('filter').value = 'all';
        render();
      };
      render();
      })();
    </script></body></html>`
}
