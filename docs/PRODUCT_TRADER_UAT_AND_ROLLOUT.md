# Product trader distribution — UAT and rollout

## Release gate

Keep `product_trader_distribution_enabled` disabled while migrations are applied. Finance must verify the product catalog, prices, commission rules, accounting defaults, active agents, and linked trader users before enabling it from **مبيعات وأسعار التجار**.

## End-to-end UAT

1. Finance receives/imports serialized products and assigns units to a field agent.
2. The field agent opens **منتجات التجار**, selects an owned trader and units held by that agent, then issues the handover.
3. Confirm that a second handover cannot use any of the same serials.
4. The trader opens **منتجاتي**, accepts one unit, marks another missing/damaged, and signs when signature enforcement is enabled.
5. Confirm accepted units enter trader custody and rejected units return to the agent or quarantine.
6. The trader records a sale inside the configured price range. Confirm the unit leaves custody, a sale and two commission snapshots are created, and the outbox posts the accounting journal.
7. Enter an out-of-range price. Confirm sale is blocked until Finance approves the one-time exception.
8. Submit a trader collection, confirm it as the owning agent, and verify the outstanding balance and accounting journal decrease by the same amount.
9. Request a return with evidence, receive it as the agent, and verify the unit leaves trader custody.
10. Report a missing device, verify it appears in on-ground oversight, recover it, and confirm the serial returns to agent custody.

## Permission UAT

- Finance owns catalog, cost, price, commission rules, feature activation, price exceptions, and financial reporting.
- On-ground managers can monitor distribution and exceptions but cannot edit product cost or commercial terms.
- Field agents can act only on their own custody and their assigned traders.
- Traders can act only on serials in their own custody and their own financial records.

## Operations

- Schedule `POST /api/internal/product-inventory` with `Authorization: Bearer $OUTBOX_WORKER_SECRET` every 15 minutes.
- Alert on failed sale/collection postings, stale handovers, open losses beyond the agreed SLA, and dead-letter outbox events.
- Roll back operationally by disabling the feature flag; never roll back the additive database migrations after data exists.
