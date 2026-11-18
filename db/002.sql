ALTER TABLE orders ADD COLUMN request_key TEXT;
CREATE UNIQUE INDEX orders_request_unique ON orders(user_id,request_key) WHERE request_key IS NOT NULL;
