const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

module.exports = (owner) => ({
  id: "FLOW-PLAN",
  area: "Full publishing journey",
  title:
    "Register → Free/Silver publishing → checkout → archive → password → deactivate/reactivate → delete",
  async run(t) {
    const phone = "+12025550180";
    const password = process.env.QA_PASSWORD_LOCAL;
    await t.call(null, "POST", "/auth/register", {
      body: { phone, password, name: "Plan flow fixture" },
      expect: 201,
    });
    const login = await t.call(null, "POST", "/auth/login", {
      body: { phone, password },
      expect: 200,
    });
    const me = await t.api.request("GET", "/users/me", {
      token: login.body.accessToken,
    });
    assert.equal(me.status, 200);
    t.state.sessions.plan = {
      ...login.body,
      userId: me.body.id,
      deviceHeaders: {},
    };
    const data = {
      title: "[QA automated test] plan flow",
      price: 100,
      propertyType: "Land",
      listingType: "Sale",
      contactPhone: phone,
      status: "Active",
    };
    const first = await t.call("plan", "POST", "/properties", {
      body: data,
      expect: 201,
      label: "Free: first listing publishes without checkout",
    });
    assert.equal(first.body.status, "Active");
    await t.call("plan", "POST", "/properties", {
      body: data,
      expect: 402,
      label: "Free: second public post requires a plan/payment",
    });
    const second = await t.call("plan", "POST", "/properties", {
      body: { ...data, status: "Draft" },
      expect: 201,
    });
    const oneTime = await t.call("plan", "POST", "/payments/checkout", {
      body: {
        propertyId: second.body.id,
        requestId: randomUUID(),
        method: "aba_pay",
      },
      expect: 201,
    });
    assert.equal(oneTime.body.status, "Success");
    const quote = await t.call(
      "plan",
      "GET",
      "/payments/subscriptions/quote/silver",
      { expect: 200 },
    );
    const bought = await t.call(
      "plan",
      "POST",
      "/payments/subscriptions/checkout",
      {
        body: {
          tier: "silver",
          requestId: randomUUID(),
          method: "aba_pay",
          quote: quote.body.quote,
        },
        expect: 201,
      },
    );
    assert.equal(bought.body.status, "Success");
    const current = await t.call(
      "plan",
      "GET",
      "/payments/subscriptions/current",
      { expect: 200 },
    );
    assert.equal(current.body.subscription.tier, "silver");
    assert.equal(current.body.subscription.listingLimit, 10);
    const included = [];
    for (let index = 0; index < 9; index++) {
      const listing = await t.call("plan", "POST", "/properties", {
        body: data,
        expect: 201,
        label: `Silver: included post ${index + 2} needs no checkout`,
      });
      included.push(listing.body.id);
    }
    const payments = await owner.query(
      "SELECT purpose, count(*)::int AS count FROM payment.payment_transactions WHERE user_id=$1 GROUP BY purpose",
      [me.body.id],
    );
    assert.deepEqual(
      Object.fromEntries(payments.rows.map((row) => [row.purpose, row.count])),
      { LISTING_PUBLISH: 1, SUBSCRIPTION: 1 },
    );
    const usage = await t.call(
      "plan",
      "GET",
      "/properties/my/publishing-usage",
      { expect: 200 },
    );
    assert.equal(usage.body.used, 10);
    await t.call("plan", "POST", "/properties", {
      body: data,
      expect: 402,
      label: "Silver: the eleventh plan-backed listing is not free",
    });
    await t.call("plan", "PATCH", `/properties/${included[0]}/unpublish`, {
      expect: 200,
    });
    const archived = await t.call(
      "plan",
      "GET",
      "/properties/my/publishing-usage",
      { expect: 200 },
    );
    assert.equal(archived.body.used, 9);
    await t.call("plan", "PATCH", `/properties/${included[0]}/publish`, {
      expect: 200,
    });
    const cancelled = await t.call(
      "plan",
      "POST",
      "/payments/subscriptions/cancel",
      { expect: 201 },
    );
    assert.equal(cancelled.body.subscription.cancelAtPeriodEnd, true);
    const remains = await t.call(
      "plan",
      "GET",
      "/payments/subscriptions/current",
      { expect: 200 },
    );
    assert.equal(remains.body.subscription.tier, "silver");
    await t.call(null, "POST", "/auth/logout", {
      body: { refreshToken: login.body.refreshToken },
      expect: 200,
    });
    await t.call("plan", "GET", "/users/me", {
      expect: 401,
      label: "Logged-out access token is no longer usable",
    });

    const signIn = async (secret) => {
      const response = await t.call(null, "POST", "/auth/login", {
        body: { phone, password: secret },
        expect: 200,
      });
      t.state.sessions.plan = {
        ...response.body,
        userId: me.body.id,
        deviceHeaders: {},
      };
    };
    const establishDevice = () =>
      owner.query(
        "UPDATE account.refresh_tokens SET session_started_at=now()-interval '2 days' WHERE user_id=$1",
        [me.body.id],
      );
    await signIn(password);
    await establishDevice(); // Advance only the disposable fixture, never weaken the one-day rule.
    const newPassword = `${password}-changed`;
    await t.call("plan", "POST", "/auth/change-password", {
      body: { currentPassword: password, newPassword },
      expect: 200,
    });
    await t.call(null, "POST", "/auth/login", {
      body: { phone, password },
      expect: 401,
      label: "Old password is rejected after change",
    });
    await t.call("plan", "POST", "/auth/account/deactivate", {
      body: { password: newPassword },
      expect: 200,
    });
    await t.call("plan", "GET", "/users/me", { expect: 401 });
    await signIn(newPassword);
    await t.call("plan", "GET", "/users/me", {
      expect: 200,
      label: "Signing in restores a deactivated account",
    });
    await establishDevice();
    await t.call("plan", "POST", "/auth/account/delete", {
      body: { password: newPassword },
      expect: 200,
    });
    await t.call("plan", "GET", "/users/me", { expect: 401 });
    assert.equal(
      (
        await owner.query(
          "SELECT count(*)::int AS count FROM account.users WHERE id=$1",
          [me.body.id],
        )
      ).rows[0].count,
      0,
    );
    assert.equal(
      (
        await owner.query(
          "SELECT count(*)::int AS count FROM listing.properties WHERE user_id=$1",
          [me.body.id],
        )
      ).rows[0].count,
      0,
    );
    const retained = await owner.query(
      "SELECT user_id, status FROM payment.payment_transactions WHERE id=ANY($1::uuid[])",
      [[oneTime.body.transactionId, bought.body.transactionId]],
    );
    assert.equal(retained.rowCount, 2);
    assert.ok(
      retained.rows.every(
        (row) => row.user_id === null && row.status === "Success",
      ),
    );
    delete t.state.sessions.plan;
  },
});
