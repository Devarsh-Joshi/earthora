import { useState } from 'react';
import { MessageSquare, Copy, ExternalLink } from 'lucide-react';
import { api } from '../api';
import { Section, useAsync, Spinner, Toggle, Modal } from '../ui';

const STORE = 'http://localhost:5173';

export function Channels() {
  const list = useAsync<any>(() => api('/platform/channels'), []);
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      <div><h1 className="font-serif text-2xl">Channels</h1><p className="text-sm text-[#7d8f83] mt-1">The website chat assistant. Its persona, workflows and settings publish to new conversations.</p></div>
      {list.loading ? <div className="text-[#7d8f83]"><Spinner /></div> : (
        <div className="grid md:grid-cols-2 gap-4">
          {list.data.channels.map((c: any) => { const Icon = MessageSquare; return (
            <button key={c.id} className="card p-5 text-left hover:border-[#2f6d48] transition" onClick={() => setOpenId(c.id)}>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-[#1c2b23] flex items-center justify-center"><Icon className="w-5 h-5 text-[#9fd0b4]" /></div>
                <div className="flex-1"><div className="text-sm font-semibold">{c.name}</div><div className="text-xs text-[#7d8f83] capitalize">{c.type}</div></div>
                <span className="tag" style={{ background: c.enabled ? '#1c2b23' : '#2a2017', color: c.enabled ? '#9fd0b4' : '#e0a050' }}>{c.enabled ? 'live' : 'off'}</span>
              </div>
              <div className="text-xs text-[#7d8f83]">Version {c.version} · {c.published_at ? 'published' : 'draft'}</div>
            </button>
          ); })}
        </div>
      )}
      {openId && <ChannelEditor channel={list.data.channels.find((c: any) => c.id === openId)} onClose={() => { setOpenId(null); list.reload(); }} />}
    </div>
  );
}

function ChannelEditor({ channel, onClose }: { channel: any; onClose: () => void }) {
  const [cfg, setCfg] = useState(() => JSON.stringify(channel.draft_config, null, 2));
  const [enabled, setEnabled] = useState(channel.enabled); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const save = async (publish: boolean) => {
    setBusy(true); setErr('');
    try { const parsed = JSON.parse(cfg); await api(`/platform/channels/${channel.id}`, { method: 'PATCH', json: { draft_config: parsed, enabled } }); if (publish) await api(`/platform/channels/${channel.id}/publish`, { method: 'POST' }); onClose(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const embed = `<script src="${location.origin}/widget.js" data-channel="${channel.public_key}" defer></script>`;
  return (
    <Modal title={`${channel.name} settings`} onClose={onClose} wide>
      <div className="flex items-center justify-between mb-4"><label className="flex items-center gap-2 text-sm text-[#cdd8d0]">Channel enabled <Toggle on={enabled} onChange={setEnabled} /></label>{channel.public_key && <code className="text-xs text-[#7d8f83]">{channel.public_key}</code>}</div>
      {channel.type === 'chat' && (
        <Section title="Install">
          <div className="flex items-center gap-2 mb-2"><a className="btn btn-ghost" href={`${STORE}/assistant`} target="_blank"><ExternalLink className="w-4 h-4" /> Hosted page</a></div>
          <div className="text-[11px] uppercase tracking-wider text-[#7d8f83] mb-1">Embed snippet</div>
          <div className="flex gap-2"><code className="input text-xs flex-1 py-2 overflow-x-auto whitespace-nowrap">{embed}</code><button className="btn btn-ghost" onClick={() => navigator.clipboard.writeText(embed)}><Copy className="w-4 h-4" /></button></div>
        </Section>
      )}
      <div className="mt-4"><div className="text-[11px] uppercase tracking-wider text-[#7d8f83] mb-1">Configuration (persona, greeting, appearance, provider)</div><textarea className="input font-mono text-xs" style={{ minHeight: 260 }} value={cfg} onChange={(e) => setCfg(e.target.value)} /></div>
      {err && <p className="text-xs text-red-400 mt-2">{err}</p>}
      <div className="flex justify-end gap-2 mt-4"><button className="btn btn-ghost" onClick={() => save(false)} disabled={busy}>Save draft</button><button className="btn btn-primary" onClick={() => save(true)} disabled={busy}>{busy ? <Spinner /> : 'Publish'}</button></div>
    </Modal>
  );
}
