-- Migration: 20261005000100_mitra_trip_nullable_delivery_order_resources.sql
-- Purpose: Revert the NOT NULL promoted on delivery_orders.vehicle_ref and
--          delivery_orders.driver_ref by 0019_relational_integrity_constraints.sql (DB-3).
--
-- 0019 tightened these columns only because no existing rows had NULL values at the
-- time. That assumption is no longer valid:
--
--   1. Trip Mitra (tripOwnership = 'MITRA') never has an internal vehicle or driver.
--      The workflow already scrubs both fields on create, so the NOT NULL constraint
--      rejected every Mitra surat jalan with
--      `null value in column "vehicle_ref" of relation "delivery_orders"`.
--   2. Internal trips are also legitimately created before the fleet is assigned.
--      A DO in status CREATED without vehicle/driver is a supported state: the trip
--      detail page shows the "Armada Trip Belum Lengkap" warning for it.
--
-- Both must stay nullable for the full lifecycle: create SJ -> run trip ->
-- DELIVERED / PARTIAL_HOLD -> close trip. Trip closure already skips odometer
-- updates when vehicle_ref is NULL (applyTripClosureOdometerUpdates).
--
-- public.trips.vehicle_ref and public.trips.driver_ref were never promoted to
-- NOT NULL, so no change is needed there.

BEGIN;

ALTER TABLE public.delivery_orders
    ALTER COLUMN vehicle_ref DROP NOT NULL,
    ALTER COLUMN driver_ref DROP NOT NULL;

COMMENT ON COLUMN public.delivery_orders.vehicle_ref IS
    'NULL for Trip Mitra, and for internal trips still awaiting fleet assignment. Trip closure skips odometer updates when NULL.';

COMMENT ON COLUMN public.delivery_orders.driver_ref IS
    'NULL for Trip Mitra. Internal trips may be created before the driver is assigned.';

COMMIT;