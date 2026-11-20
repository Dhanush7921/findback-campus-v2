// Minimal in-process fake of the Google Sheets v4 values API and Cloud Storage JSON API, for SheetsStore tests.
import { TABLES } from '../../shared/domain';

/** V1 column counts per tab, to simulate the existing production sheet. */
export const V1_COLS: Record<string, number> = { Complaints: 25, Access_Credentials: 8, Found_Items: 16, Claim_Requests: 11, Complaint_Updates: 9, Handover_Records: 10, Activity_Log: 7, Application_Settings: 4 };

export function createFakeGoogle(opts: { headers?: boolean; legacy?: boolean } = {}) {
  const sheets: Record<string, string[][]> = {};
  for (const [t, cols] of Object.entries(TABLES)) {
    if (opts.legacy && !(t in V1_COLS)) continue;
    sheets[t] = opts.headers === false ? [] : [[...cols].slice(0, opts.legacy ? V1_COLS[t] : cols.length)];
  }
  const objects = new Map<string, { mime: string; bytes: Uint8Array }>();
  const calls: string[] = [];
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  const parseRange = (r: string) => {
    const [t, a1] = decodeURIComponent(r).split('!');
    const m = /^A(\d+)?(?::[A-Z]+(\d+)?)?$/.exec(a1 ?? 'A1');
    return { t, row: m?.[1] ? Number(m[1]) : 1, headerOnly: a1 === '1:1' };
  };
  const fetchImpl = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    calls.push(`${method} ${url.pathname}`);
    if (!String((init.headers as Record<string, string>)?.authorization ?? '').startsWith('Bearer ')) return json({}, 401);
    const p = url.pathname;
    const titles = Object.keys(sheets);
    if (/\/spreadsheets\/[^/:]+$/.test(p) && method === 'GET') {
      return json({ sheets: titles.map((title, i) => ({ properties: { sheetId: 100 + i, title } })) });
    }
    if (p.endsWith(':batchUpdate') && !p.includes('/values')) {
      const body = JSON.parse(String(init.body)) as { requests: any[] };
      const val = (row: any) => row.values.map((v: any) => v.userEnteredValue.stringValue as string);
      for (const r of body.requests) {
        if (r.addSheet) sheets[r.addSheet.properties.title] = [];
        if (r.updateCells) {
          const { sheetId, rowIndex, columnIndex = 0 } = r.updateCells.start;
          const tab = sheets[titles[sheetId - 100]];
          while (tab.length <= rowIndex) tab.push([]);
          const row = [...(tab[rowIndex] ?? [])];
          val(r.updateCells.rows[0]).forEach((v: string, k: number) => { row[columnIndex + k] = v; });
          tab[rowIndex] = row;
          continue;
        }
        if (r.appendCells) sheets[titles[r.appendCells.sheetId - 100]].push(...r.appendCells.rows.map(val));
      }
      return json({});
    }
    if (p.endsWith('/values:batchGet')) {
      return json({ valueRanges: url.searchParams.getAll('ranges').map((r) => { const q = parseRange(r); const v = sheets[q.t] ?? []; return { values: q.headerOnly ? v.slice(0, 1) : v }; }) });
    }
    if (p.includes('/values/') && p.endsWith(':append')) {
      const t = parseRange(p.split('/values/')[1].replace(':append', '')).t;
      const body = JSON.parse(String(init.body)) as { values: string[][] };
      sheets[t].push(...body.values);
      return json({ updates: { updatedRows: body.values.length } });
    }
    if (p.endsWith('/values:batchUpdate')) {
      const body = JSON.parse(String(init.body)) as { data: { range: string; values: string[][] }[] };
      for (const d of body.data) { const { t, row } = parseRange(d.range); sheets[t][row - 1] = d.values[0]; }
      return json({});
    }
    if (p.startsWith('/upload/storage/v1/b/')) {
      const name = url.searchParams.get('name')!;
      const raw = init.body as Uint8Array | string;
      objects.set(name, { mime: (init.headers as Record<string, string>)['content-type'], bytes: typeof raw === 'string' ? new TextEncoder().encode(raw) : raw });
      return json({ name });
    }
    const obj = /^\/storage\/v1\/b\/[^/]+\/o\/(.+)$/.exec(p);
    if (obj) {
      const name = decodeURIComponent(obj[1]);
      if (method === 'DELETE') { objects.delete(name); return new Response(null, { status: 204 }); }
      const o = objects.get(name);
      return o ? new Response(o.bytes, { headers: { 'content-type': o.mime } }) : json({ error: 'not found' }, 404);
    }
    return json({ error: 'unhandled ' + p }, 400);
  };
  return { sheets, objects, calls, fetchImpl: fetchImpl as typeof fetch };
}
