create table if not exists public.trips (
    source_document_id text primary key,
    delivery_order_ref text references public.delivery_orders(source_document_id) on delete set null,
    order_ref text references public.orders(source_document_id) on delete set null,
    trip_number text not null,
    master_resi text,
    customer_ref text references public.customers(source_document_id) on delete set null,
    customer_name text,
    vehicle_ref text references public.vehicles(source_document_id) on delete set null,
    vehicle_plate text,
    driver_ref text references public.drivers(source_document_id) on delete set null,
    driver_name text,
    trip_date date not null,
    status text not null,
    pickup_address text,
    receiver_name text,
    receiver_phone text,
    receiver_address text,
    receiver_company text,
    service_ref text references public.services(source_document_id) on delete set null,
    service_name text,
    vehicle_service_ref text references public.services(source_document_id) on delete set null,
    vehicle_service_name text,
    vehicle_category_override_reason text,
    trip_route_rate_ref text references public.trip_route_rates(source_document_id) on delete set null,
    trip_origin_area text,
    trip_destination_area text,
    tracking_state text,
    tracking_started_at timestamptz,
    tracking_stopped_at timestamptz,
    tracking_last_seen_at timestamptz,
    pending_driver_status text,
    cargo_finalized_at timestamptz,
    tarip_borongan numeric,
    notes text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create unique index if not exists idx_trips_trip_number on public.trips (trip_number);
create index if not exists idx_trips_delivery_order_ref on public.trips (delivery_order_ref);
create index if not exists idx_trips_order_ref on public.trips (order_ref);
create index if not exists idx_trips_customer_ref on public.trips (customer_ref, trip_date desc);
create index if not exists idx_trips_vehicle_ref on public.trips (vehicle_ref, trip_date desc);
create index if not exists idx_trips_driver_ref on public.trips (driver_ref, trip_date desc);

create table if not exists public.surat_jalan_documents (
    source_document_id text primary key,
    trip_ref text not null references public.trips(source_document_id) on delete cascade,
    delivery_order_ref text references public.delivery_orders(source_document_id) on delete set null,
    order_ref text references public.orders(source_document_id) on delete set null,
    customer_ref text references public.customers(source_document_id) on delete set null,
    customer_name text,
    reference_key text,
    surat_jalan_number text not null,
    pickup_address text,
    receiver_name text,
    receiver_company text,
    receiver_address text,
    trip_date date,
    trip_status text,
    vehicle_plate text,
    driver_name text,
    item_count integer not null default 0,
    cargo_summary jsonb not null default '{}'::jsonb,
    billable_cargo jsonb not null default '{}'::jsonb,
    hold_cargo jsonb not null default '{}'::jsonb,
    return_cargo jsonb not null default '{}'::jsonb,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create unique index if not exists idx_surat_jalan_documents_trip_ref_reference_key
    on public.surat_jalan_documents (trip_ref, coalesce(reference_key, 'primary'));
create index if not exists idx_surat_jalan_documents_delivery_order_ref on public.surat_jalan_documents (delivery_order_ref);
create index if not exists idx_surat_jalan_documents_order_ref on public.surat_jalan_documents (order_ref);
create index if not exists idx_surat_jalan_documents_customer_ref on public.surat_jalan_documents (customer_ref, trip_date desc);
create index if not exists idx_surat_jalan_documents_number on public.surat_jalan_documents (surat_jalan_number);

create table if not exists public.surat_jalan_items (
    source_document_id text primary key,
    surat_jalan_ref text not null references public.surat_jalan_documents(source_document_id) on delete cascade,
    trip_ref text not null references public.trips(source_document_id) on delete cascade,
    delivery_order_item_ref text references public.delivery_order_items(source_document_id) on delete set null,
    reference_key text,
    surat_jalan_number text not null,
    order_item_description text,
    planned_cargo jsonb not null default '{}'::jsonb,
    actual_cargo jsonb not null default '{}'::jsonb,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create index if not exists idx_surat_jalan_items_surat_jalan_ref on public.surat_jalan_items (surat_jalan_ref);
create index if not exists idx_surat_jalan_items_trip_ref on public.surat_jalan_items (trip_ref);
create index if not exists idx_surat_jalan_items_delivery_order_item_ref on public.surat_jalan_items (delivery_order_item_ref);
