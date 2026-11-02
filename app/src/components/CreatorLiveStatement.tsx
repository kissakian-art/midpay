import React, { useEffect, useState } from 'react';
import { Text, View, TouchableOpacity } from 'react-native';
import { getLiveStatement, type LiveStatement } from '../api';
import { colors, ugx } from '../theme';

export default function CreatorLiveStatement({ liveId, live = false }: { liveId: string; live?: boolean }) {
  const [open, setOpen] = useState(live);
  const [data, setData] = useState<LiveStatement | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try { const result = await getLiveStatement(liveId); if (active) { setData(result); setError(false); } }
      catch { if (active) setError(true); }
      if (active) timer = setTimeout(load, 15000);
    };
    void load();
    return () => { active = false; clearTimeout(timer); };
  }, [open, liveId]);
  const line = (label: string, value: string) => <Text style={{ color: colors.text, marginVertical: 2 }}>{label}: {value}</Text>;
  return <View style={{ backgroundColor: colors.bg, padding: 12, borderRadius: 10, marginVertical: 8 }}>
    {!live && <TouchableOpacity onPress={() => setOpen(!open)}><Text style={{ color: colors.accent }}>{open ? 'Hide statement' : 'View earnings statement'}</Text></TouchableOpacity>}
    {open && <>
      {error && line('Update', 'Unavailable — figures below may be out of date')}
      {!data ? line('Statement', 'Loading…') : <>
        {live && data.status === 'live' && line('Connected viewers', error || data.connectedViewers == null ? 'Unavailable' : String(data.connectedViewers))}
        {line('Ticket price', ugx(data.ticketPriceUgx))}
        {line('Paid tickets', String(data.totals.tickets))}
        {data.creatorSplitBps != null ? line('Your share after collection fees', `${data.creatorSplitBps / 100}%`) : data.groups.filter(g => g.status === 'paid').map(g => <Text key={g.creatorSplitBps} style={{ color: colors.dim }}>{g.count} paid tickets at {g.creatorSplitBps / 100}% after collection fees · {ugx(g.creatorUgx)}</Text>)}
        {line('Your earnings', ugx(data.totals.creatorUgx))}
        {line('Payments awaiting confirmation', String(data.pendingPayments))}
        <Text style={{ color: colors.dim }}>{data.eligibleAfterSession ? 'These earnings count toward your eligible balance.' : 'Earnings become eligible after the session completes. Interrupted sessions may require review.'}</Text>
        <Text style={{ color: colors.dim }}>Updated {new Date(data.sampledAt).toLocaleTimeString()}. Viewers and ticket sales are different counts. Figures may change with late payment confirmations.</Text>
      </>}
    </>}
  </View>;
}
