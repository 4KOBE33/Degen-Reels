// Real cards: a shoe of six full decks, shuffled properly and dealt without putting cards back.
// When the cut card comes out (about three-quarters of the way through) the whole shoe is
// shuffled again before the next hand, like a real table.
export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const DECKS = 6;

export class Shoe {
  constructor(decks = DECKS) {
    this.decks = decks;
    this.shuffle();
  }

  // Fisher-Yates over every card of every deck, with a cut card placed 70-80% of the way in.
  shuffle() {
    const cards = [];
    for (let d = 0; d < this.decks; d++) for (const suit of SUITS) for (const rank of RANKS) cards.push({ rank, suit });
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    this.cards = cards;
    this.cut = Math.floor(cards.length * (0.2 + Math.random() * 0.1)); // cards left when it comes out
    this.reshuffle = false;
  }

  get left() { return this.cards.length; }
  get total() { return this.decks * 52; }

  // Call between hands: shuffles if the cut card came out last hand. Returns true if it did.
  ready() {
    if (!this.reshuffle) return false;
    this.shuffle();
    return true;
  }

  draw() {
    if (!this.cards.length) this.shuffle(); // never happens with a cut card, but never run dry
    const c = this.cards.pop();
    if (this.cards.length <= this.cut) this.reshuffle = true;
    return { ...c };
  }
}

export const cardValue = (c) => (c.rank === 'A' ? 11 : 'JQK'.includes(c.rank) ? 10 : Number(c.rank));
export function handValue(hand) {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    total += cardValue(c);
    if (c.rank === 'A') aces++;
  }
  while (total > 21 && aces) { total -= 10; aces--; }
  return total;
}
export const isSoft = (hand) => {
  let total = 0;
  let aces = 0;
  for (const c of hand) { total += cardValue(c); if (c.rank === 'A') aces++; }
  while (total > 21 && aces) { total -= 10; aces--; }
  return aces > 0 && total <= 21;
};
export const isNatural = (h) => h.cards.length === 2 && !h.split && handValue(h.cards) === 21;
