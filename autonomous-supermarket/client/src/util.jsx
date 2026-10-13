export const get = (p) => fetch('/api' + p).then((r) => { if (!r.ok) throw new Error(`${r.status} ${p}`); return r.json(); });
export const money = (c) => 'A$' + ((c ?? 0) / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const num = (n) => Number(n ?? 0).toLocaleString('en-AU');
export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const detail = (j) => {
  try { return Object.entries(JSON.parse(j)).map(([k, v]) => `${k}=${v}`).join(', '); } catch { return j ?? ''; }
};

export function Bars({ data, height = 90 }) {           // data: [{label, value, title, color}]
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="bars" style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="bar" title={d.title ?? `${d.label}: ${d.value}`}
             style={{ height: `${(d.value / max) * 100}%`, background: d.color ?? '#2563eb' }}
             onClick={d.onClick} />
      ))}
    </div>
  );
}

export function Table({ cols, rows, onRow, empty = 'None recorded (0)' }) {
  if (!rows?.length) return <p className="muted">{empty}</p>;
  return (
    <div className="scroll">
      <table>
        <thead><tr>{cols.map((c, i) => <th key={i} className={c.right ? 'r' : ''}>{c.h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={onRow ? 'click' : ''} onClick={onRow ? () => onRow(r) : undefined}>
              {cols.map((c, j) => <td key={j} className={c.right ? 'r' : ''}>{c.f ? c.f(r) : r[c.k]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const Card = ({ title, children }) => <section className="card">{title && <h3>{title}</h3>}{children}</section>;
export const Kpi = ({ label, value, sub }) => (
  <div className="kpi"><div className="kl">{label}</div><div className="kv">{value}</div>{sub && <div className="ks">{sub}</div>}</div>
);