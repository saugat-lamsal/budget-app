import { describe, expect, it } from 'vitest';
import { onItsWayDetail, onItsWayTitle } from '../src/screens/buckets-text.js';

// The words for money on its way between his accounts, on Buckets (12.5, B44).

describe('12.5 the words for money on its way', () => {
  it('12.5 each says where it is going', () => {
    expect(['savings', 'checking', 'everyday-card', 'old-card'].map((to) => onItsWayTitle({ to: to as 'savings' }))).toEqual(['To savings', 'To checking', 'Payment to the everyday card', 'Payment to the old card']);
  });

  it('12.5 what left and has not landed, and what landed before it showed leaving', () => {
    expect(onItsWayDetail({ from: 'checking', to: 'savings', date: '2026-10-02', seen: 'left', counted: true })).toBe('Left Checking Fri, Oct 2. Not in Savings yet.');
    expect(onItsWayDetail({ from: 'checking', to: 'everyday-card', date: '2026-09-30', seen: 'arrived', counted: true })).toBe('Reached the everyday card Wed, Sep 30. Not shown leaving Checking yet.');
  });

  it('12.4 B44 one to the old card says it is not part of the check', () => {
    expect(onItsWayDetail({ from: 'checking', to: 'old-card', date: '2026-10-09', seen: 'left', counted: false })).toBe('Left Checking Fri, Oct 9. Not on the old card yet. Not part of the check with your bank: the old card is kept apart.');
  });
});
