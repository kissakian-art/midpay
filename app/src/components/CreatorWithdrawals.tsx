import React, { useCallback, useEffect, useState } from 'react';
import { Text, TextInput, View, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, getWithdrawals, quoteWithdrawal, requestWithdrawal, type WithdrawalOverview, type WithdrawalQuote } from '../api';
import { useAuth } from '../auth';
import { colors, ugx } from '../theme';

export default function CreatorWithdrawals() {
  const { user } = useAuth();
  const key = `midpay.withdrawal.${user?.id}`;
  const [data, setData] = useState<WithdrawalOverview | null>(null);
  const [amount, setAmount] = useState('');
  const [provider, setProvider] = useState('mtn');
  const [quote, setQuote] = useState<WithdrawalQuote | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const refresh = useCallback(async () => { try { setData(await getWithdrawals()); } catch { setMessage('Unable to refresh withdrawals. Please retry.'); } }, []);
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(key).then(raw => { if (active && raw) { setQuote(JSON.parse(raw)); setSubmitted(true); } if (active) setReady(true); }).catch(() => setMessage('Unable to restore withdrawal requests. Reopen this screen before withdrawing.'));
    void refresh();
    const timer = setInterval(refresh, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [key, refresh]);
  const run = async (work: () => Promise<void>) => { if (busy) return; setBusy(true); setMessage(''); try { await work(); } catch (e) { setMessage(e instanceof Error ? e.message : 'Please retry'); } finally { setBusy(false); await refresh(); } };
  const button = (label: string, action: () => void, disabled = false) => <TouchableOpacity disabled={busy || disabled} onPress={action} style={{ paddingVertical: 12, opacity: busy || disabled ? 0.5 : 1 }}><Text style={{ color: colors.accent }}>{busy ? 'Please wait…' : label}</Text></TouchableOpacity>;
  return <View style={{ padding: 14, marginVertical: 12, backgroundColor: colors.card, borderRadius: 12 }}>
    <Text style={{ color: colors.text, fontSize: 18 }}>Withdraw to mobile money</Text>
    {data && <>
      <Text style={{ color: colors.text }}>Pending live earnings: {ugx(data.pendingLiveUgx)}{ '\n' }Eligible balance: {ugx(data.eligibleUgx)}{ '\n' }Processing: {ugx(data.processingUgx)}{ '\n' }Minimum: {ugx(data.minimumUgx)}</Text>
      <Text style={{ color: colors.dim }}>{data.enabled ? 'Completion depends on your mobile-money provider. No guaranteed arrival time.' : 'Self-service withdrawals are awaiting activation.'}</Text>
      {quote ? <>
        <Text style={{ color: colors.text }}>Deduct {ugx(quote.amountUgx)} · fee {ugx(quote.feeUgx)}{ '\n' }Receive {ugx(quote.netUgx)} on {quote.phone} ({quote.provider.toUpperCase()})</Text>
        {button(submitted ? 'Check / retry the same withdrawal' : 'Confirm withdrawal', () => void run(async () => {
          await AsyncStorage.setItem(key, JSON.stringify(quote));
          setSubmitted(true);
          const result = await requestWithdrawal(quote).catch(async error => {
            // A definitive pre-reservation rejection allows a fresh quote. A network timeout must retain its ID.
            if (error instanceof ApiError && ['fee_changed', 'invalid_amount', 'payout_funding', 'withdrawals_disabled', 'withdrawal_processing', 'balance_changed'].includes(error.code)) {
              await AsyncStorage.removeItem(key);
              setQuote(null); setSubmitted(false);
            }
            throw error;
          });
          await AsyncStorage.removeItem(key);
          setQuote(null); setSubmitted(false);
          setMessage(result.status === 'sent' ? 'Provider confirmed payment.' : result.status === 'failed' ? 'Withdrawal failed; reserved earnings were returned.' : 'Withdrawal is processing. Follow its status below.');
        }), !ready)}
        {!submitted && button('Cancel quote', () => setQuote(null))}
      </> : <>
        <TextInput accessibilityLabel="Withdrawal amount in UGX" value={amount} onChangeText={v => setAmount(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" placeholder="Amount in UGX" placeholderTextColor={colors.dim} style={{ color: colors.text, padding: 12, borderWidth: 1, borderColor: colors.dim, marginTop: 10 }} />
        {button(`Network: ${provider.toUpperCase()} — tap to switch`, () => setProvider(provider === 'mtn' ? 'airtel' : 'mtn'))}
        {button('Review withdrawal', () => void run(async () => { setQuote(await quoteWithdrawal(Number(amount), provider)); }), !data.enabled || !ready)}
      </>}
      {data.history.slice(0, 10).map(p => <Text key={p.id} style={{ color: colors.text, marginTop: 8 }}>{new Date(p.createdAt).toLocaleDateString()} · {ugx(p.netUgx)} · {p.status === 'sent' ? 'Paid (provider confirmed)' : p.status === 'failed' ? 'Failed / released' : 'Processing'}{ '\n' }Deduction {ugx(p.amountUgx)}, fee {ugx(p.feeUgx)}</Text>)}
    </>}
    {!!message && <Text accessibilityLiveRegion="polite" style={{ color: colors.text, marginTop: 8 }}>{message}</Text>}
    {button('Refresh withdrawals', () => void refresh())}
  </View>;
}
