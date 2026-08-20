/**
 * The weekly chore, as a page: paste the token once, paste the log URL, done.
 *
 * The token lives in a variable for the life of the tab — never localStorage,
 * so a shared machine does not hand it to the next person.
 */

const $ = (id) => document.getElementById(id);
const SAMPLE_SIZE = 2;

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function headers() {
  return { 'Content-Type': 'application/json', 'x-admin-token': $('token').value };
}

function say(text, isError = false) {
  $('message').textContent = text;
  $('message').style.color = isError ? '#ff8f8f' : '';
}

async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: headers() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Server said ${res.status}`);
  return body;
}

function renderReports(reports) {
  const rows = [...reports].sort(
    (a, b) => (b.startTime ?? Date.parse(b.addedAt)) - (a.startTime ?? Date.parse(a.addedAt)),
  );
  $('reports-body').innerHTML = rows
    .map((r, i) => {
      const night = r.startTime ? new Date(r.startTime).toISOString().slice(0, 10) : `added ${r.addedAt.slice(0, 10)}`;
      return `<tr>
        <th scope="row" class="player"><a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.code)}</a></th>
        <td class="cell">${escapeHtml(night)}</td>
        <td class="cell">${escapeHtml(r.label ?? '')}</td>
        <td class="cell ${i < SAMPLE_SIZE ? 'hit' : ''}">${i < SAMPLE_SIZE ? 'in play' : '—'}</td>
        <td class="cell"><button type="button" data-remove="${escapeHtml(r.code)}">Remove</button></td>
      </tr>`;
    })
    .join('');
}

async function load() {
  if (!$('token').value) return;
  try {
    renderReports((await api('/api/reports')).reports);
  } catch (err) {
    say(err.message, true);
  }
}

$('add-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  say('Adding…');
  try {
    const body = await api('/api/reports', {
      method: 'POST',
      body: JSON.stringify({ url: $('url').value, label: $('label').value || null }),
    });
    say(
      body.added
        ? `Added ${body.report.code}. Pool is now ${body.poolSize} raiders.`
        : `${body.report.code} was already on the list.`,
    );
    for (const warning of body.warnings ?? []) say(`${$('message').textContent} ${warning}`, true);
    $('url').value = '';
    $('label').value = '';
    await load();
  } catch (err) {
    say(err.message, true);
  }
});

$('reports-body').addEventListener('click', async (event) => {
  const code = event.target.dataset?.remove;
  if (!code || !confirm(`Remove report ${code} from the list?`)) return;
  try {
    await api(`/api/reports/${code}`, { method: 'DELETE' });
    say(`Removed ${code}.`);
    await load();
  } catch (err) {
    say(err.message, true);
  }
});

$('token').addEventListener('change', load);
