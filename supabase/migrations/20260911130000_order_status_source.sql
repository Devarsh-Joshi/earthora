-- Keep the admin order workflow aligned across sales channels.
-- New paid orders begin in processing; adding a tracking link moves an active
-- order to out_for_delivery. Delivered orders are never moved backwards.

-- Normalize legacy active labels used by earlier website releases while
-- leaving cancelled/refunded records intact for historical reporting.
UPDATE orders
   SET status = CASE
     WHEN lower(status) IN ('shipped', 'packed', 'ready_for_shipment') THEN 'out_for_delivery'
     ELSE 'processing'
   END
 WHERE lower(status) IN ('pending', 'created', 'confirmed', 'shipped', 'packed', 'ready_for_shipment');
