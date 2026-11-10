import { buyerPrice, priceDrop } from './price-drop';

describe('buyerPrice', () => {
  it('takes the discount off the asking price', () => {
    expect(buyerPrice({ price: 100000 })).toBe(100000);
    expect(
      buyerPrice({ price: 100000, discountType: 'percent', discountValue: 10 }),
    ).toBe(90000);
    expect(
      buyerPrice({
        price: 100000,
        discountType: 'amount',
        discountValue: 5000,
      }),
    ).toBe(95000);
  });
});

describe('priceDrop', () => {
  it('is the fall in what a buyer pays', () => {
    expect(priceDrop({ price: 120000 }, { price: 110000 })).toEqual({
      from: 120000,
      to: 110000,
    });
  });

  it('counts a new discount as a drop', () => {
    expect(
      priceDrop(
        { price: 100000 },
        { price: 100000, discountType: 'percent', discountValue: 5 },
      ),
    ).toEqual({ from: 100000, to: 95000 });
  });

  it('is nothing for a rise, the same price, or a cut under 1%', () => {
    expect(priceDrop({ price: 100 }, { price: 120 })).toBeNull();
    expect(priceDrop({ price: 100 }, { price: 100 })).toBeNull();
    expect(priceDrop({ price: 100000 }, { price: 99500 })).toBeNull();
  });

  it('is nothing when a discount is merely moved into the price', () => {
    expect(
      priceDrop(
        { price: 100000, discountType: 'amount', discountValue: 10000 },
        { price: 90000 },
      ),
    ).toBeNull();
  });
});
