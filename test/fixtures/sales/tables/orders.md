---
type: BigQuery Table
title: Orders
description: One row per completed customer order.
grain: order_id
tags: [sales, revenue]
sources:
  - url: https://wiki.acme.test/orders
    trust: high
verified: 2026-07-01
status: current
---

Joined with [customers](./customers.md) and [payments](./payments.md).

See the [OKF spec](https://github.com/GoogleCloudPlatform/knowledge-catalog)
and [the metric](../metrics/orders.md#definition).

Self reference to [orders](./orders.md) must not appear in links.
