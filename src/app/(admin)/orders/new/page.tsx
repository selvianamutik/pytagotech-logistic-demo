'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Save, X } from 'lucide-react';

import FormattedNumberInput from '@/components/FormattedNumberInput';
import PageBackButton from '@/components/PageBackButton';
import { fetchAdminCollectionData } from '@/lib/api/admin-client';
import { getBusinessDateValue } from '@/lib/business-date';
import { formatCreditLimitCurrency, formatCustomerCreditBlockMessage, summarizeCustomerCreditUsage } from '@/lib/customer-credit-limit';
import { buildServiceCapacityRangeMap, formatUnitCapacityLabel } from '@/lib/service-capacity-support';
import { buildTripRateAreaOptions, findMatchingTripRouteRate, formatTripRouteRateLabel } from '@/lib/trip-route-rate-support';
import { buildTripResourceAssignments, tripDriverAssignments, tripVehicleAssignments } from '@/lib/trip-resource-lock-support';
import type { BankAccount, Customer, CustomerPickupLocation, DeliveryOrder, Driver, FreightNota, Order, Service, TripOwnership, TripRouteRate, Vehicle } from '@/lib/types';
import {
    applyCustomerPickupMasterSelection,
    applyCustomerPickupToStop,
    createDefaultPickupStopForm,
    findDefaultCustomerPickup,
    getDraftPickupStops,
    getPickupStopMasterValue,
    MANUAL_PICKUP_MASTER_LABEL,
    MANUAL_PICKUP_MASTER_VALUE,
    sortCustomerPickups,
    summarizePickupStopList,
    type PickupStopForm,
} from '@/lib/order-create-page-support';
import { useToast } from '../../layout';
import Combobox from '@/components/Combobox';
import { TripAssignmentDropdownMeta, TripResourceAssignmentBadges } from '@/components/TripResourceAssignmentBadges';
import { TripOwnershipSwitch } from '@/components/TripOwnershipSwitch';

type TripDraftForm = {
    id: string;
    tripOwnership: TripOwnership;
    pickupStopKeys: string[];
    vehicleRef: string;
    driverRef: string;
    tripOriginArea: string;
    tripDestinationArea: string;
    tripRouteRateRef: string;
    tripFee: number;
    vehicleOverrideReason: string;
    issueBankRef: string;
    cashGiven: number;
    notes: string;
    date: string;
};

function createDefaultTripDraftForm(pickupStopKeys: string[] = []): TripDraftForm {
    return {
        id: crypto.randomUUID(),
        tripOwnership: 'INTERNAL',
        pickupStopKeys,
        vehicleRef: '',
        driverRef: '',
        tripOriginArea: '',
        tripDestinationArea: '',
        tripRouteRateRef: '',
        tripFee: 0,
        vehicleOverrideReason: '',
        issueBankRef: '',
        cashGiven: 0,
        notes: '',
        date: getBusinessDateValue(),
    };
}

export default function NewOrderPage() {
    const router = useRouter();
    const { addToast } = useToast();
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [customerPickups, setCustomerPickups] = useState<CustomerPickupLocation[]>([]);
    const [customerCreditNotas, setCustomerCreditNotas] = useState<FreightNota[]>([]);
    const [customerCreditLoading, setCustomerCreditLoading] = useState(false);
    const [customerScopedMastersLoaded, setCustomerScopedMastersLoaded] = useState(false);
    const [services, setServices] = useState<Service[]>([]);
    const [vehicles, setVehicles] = useState<Array<Pick<Vehicle, '_id' | 'unitCode' | 'plateNumber' | 'serviceRef' | 'serviceName' | 'capacityMin' | 'capacityMax' | 'capacityKg'>>>([]);
    const [drivers, setDrivers] = useState<Driver[]>([]);
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [tripRouteRates, setTripRouteRates] = useState<TripRouteRate[]>([]);
    const [activeDeliveryOrders, setActiveDeliveryOrders] = useState<DeliveryOrder[]>([]);
    const [activeOrders, setActiveOrders] = useState<Array<Pick<Order, '_id' | 'masterResi' | 'status' | 'tripPlans'>>>([]);
    const [loading, setLoading] = useState(false);

    const [customerRef, setCustomerRef] = useState('');
    /** Additional customers this order/trip serves; the primary stays `customerRef` above. */
    const [additionalCustomerRefs, setAdditionalCustomerRefs] = useState<string[]>([]);
    const [serviceRef, setServiceRef] = useState('');
    const [pickupStops, setPickupStops] = useState<PickupStopForm[]>([createDefaultPickupStopForm()]);
    const [tripDrafts, setTripDrafts] = useState<TripDraftForm[]>([]);
    const [shouldAutoApplyDefaultPickup, setShouldAutoApplyDefaultPickup] = useState(false);
    const [notes, setNotes] = useState('');

    const selectedCustomer = customers.find(customer => customer._id === customerRef) || null;
    // The primary always comes first; extras follow. Only sent to the server when there is more
    // than one, so single-customer orders keep their existing payload shape.
    const orderCustomerRefs = customerRef ? [customerRef, ...additionalCustomerRefs] : [...additionalCustomerRefs];
    const additionalCustomerOptions = customers
        .filter(customer => customer.active !== false
            && customer._id !== customerRef
            && !additionalCustomerRefs.includes(customer._id))
        .map(customer => ({ value: customer._id, label: customer.name }));
    const customerCreditUsage = summarizeCustomerCreditUsage(selectedCustomer, customerCreditNotas);
    const selectedService = services.find(service => service._id === serviceRef) || null;
    const sortedCustomerPickups = sortCustomerPickups(customerPickups);
    const serviceCapacityRangeMap = buildServiceCapacityRangeMap(services);
    const selectedServiceCapacityLabel = selectedService ? serviceCapacityRangeMap[selectedService._id] || 'Kapasitas belum diisi' : 'Belum dipilih';
    const pickupSummary = summarizePickupStopList(pickupStops);
    const activeIssueBankAccounts = bankAccounts.filter(account => account.active !== false);
    const getVehicleServiceRef = (vehicleRef: string) => vehicles.find(vehicle => vehicle._id === vehicleRef)?.serviceRef || '';
    const getTripRouteServiceRef = (trip: Pick<TripDraftForm, 'vehicleRef'>) => serviceRef || getVehicleServiceRef(trip.vehicleRef);
    const resolveTripRateForDraft = (trip: Pick<TripDraftForm, 'vehicleRef'>, originArea: string, destinationArea: string) => findMatchingTripRouteRate(tripRouteRates, {
        originArea,
        destinationArea,
        serviceRef: getTripRouteServiceRef(trip),
    });
    const shouldResetTripFeeForRoute = (originArea: string, destinationArea: string) => Boolean(originArea && destinationArea);

    useEffect(() => {
        Promise.all([
            fetchAdminCollectionData<Customer[]>('/api/data?entity=customers', 'Gagal memuat form order'),
            fetchAdminCollectionData<Service[]>('/api/data?entity=services', 'Gagal memuat form order'),
            fetchAdminCollectionData<Array<Pick<Vehicle, '_id' | 'unitCode' | 'plateNumber' | 'serviceRef' | 'serviceName' | 'capacityMin' | 'capacityMax' | 'capacityKg'>>>(
                `/api/data?entity=vehicles&filter=${encodeURIComponent(JSON.stringify({ status: ['ACTIVE', 'IN_SERVICE'] }))}`,
                'Gagal memuat form order'
            ),
            fetchAdminCollectionData<Driver[]>('/api/data?entity=drivers', 'Gagal memuat form order'),
            fetchAdminCollectionData<BankAccount[]>('/api/data?entity=bank-accounts', 'Gagal memuat form order'),
            fetchAdminCollectionData<TripRouteRate[]>(`/api/data?entity=trip-route-rates&filter=${encodeURIComponent(JSON.stringify({ active: true }))}`, 'Gagal memuat form order'),
            fetchAdminCollectionData<DeliveryOrder[]>(
                `/api/data?entity=delivery-orders&filter=${encodeURIComponent(JSON.stringify({ status: ['CREATED', 'ON_DELIVERY', 'ARRIVED', 'PARTIAL_HOLD', 'DELIVERED'] }))}`,
                'Gagal memuat form order'
            ),
            fetchAdminCollectionData<Array<Pick<Order, '_id' | 'masterResi' | 'status' | 'tripPlans'>>>(
                `/api/data?entity=orders&filter=${encodeURIComponent(JSON.stringify({ status: ['OPEN', 'PARTIAL'] }))}`,
                'Gagal memuat form order'
            ),
        ]).then(([customerRows, serviceRows, vehicleRows, driverRows, bankRows, tripRateRows, activeDoRows, activeOrderRows]) => {
            setCustomers((customerRows || []).filter(customer => customer.active !== false));
            setServices((serviceRows || []).filter(service => service.active !== false));
            setVehicles(vehicleRows || []);
            setDrivers((driverRows || []).filter(driver => driver.active !== false));
            setBankAccounts(bankRows || []);
            setTripRouteRates((tripRateRows || []).filter(rate => rate.active !== false));
            setActiveDeliveryOrders(activeDoRows || []);
            setActiveOrders(activeOrderRows || []);
        }).catch(error => {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat form order');
        });
    }, [addToast]);

    useEffect(() => {
        const scopedCustomerRefs = [customerRef, ...additionalCustomerRefs].filter(Boolean);
        if (scopedCustomerRefs.length === 0) {
            setCustomerPickups([]);
            setCustomerScopedMastersLoaded(false);
            return;
        }

        let cancelled = false;
        setCustomerScopedMastersLoaded(false);
        const loadCustomerScopedMasters = async () => {
            try {
                // One request per customer keeps us on the proven single-value filter path.
                const rowsPerCustomer = await Promise.all(scopedCustomerRefs.map(ref =>
                    fetchAdminCollectionData<CustomerPickupLocation[]>(
                        `/api/data?entity=customer-pickups&filter=${encodeURIComponent(JSON.stringify({ customerRef: ref, active: true }))}`,
                        'Gagal memuat master customer'
                    )
                ));
                const mergedPickups = Array.from(
                    new Map(
                        rowsPerCustomer
                            .flatMap(rows => rows || [])
                            .map(pickup => [pickup._id, pickup])
                    ).values()
                );
                if (!cancelled) {
                    setCustomerPickups(mergedPickups);
                    setCustomerScopedMastersLoaded(true);
                }
            } catch (error) {
                if (!cancelled) {
                    setCustomerPickups([]);
                    setCustomerScopedMastersLoaded(true);
                    addToast('error', error instanceof Error ? error.message : 'Gagal memuat master customer');
                }
            }
        };

        void loadCustomerScopedMasters();
        return () => {
            cancelled = true;
        };
    }, [addToast, customerRef, additionalCustomerRefs]);

    useEffect(() => {
        if (!customerRef) {
            setCustomerCreditNotas([]);
            setCustomerCreditLoading(false);
            return;
        }

        let cancelled = false;
        setCustomerCreditLoading(true);
        const loadCustomerCredit = async () => {
            try {
                const notaRows = await fetchAdminCollectionData<FreightNota[]>(
                    `/api/data?entity=freight-notas&filter=${encodeURIComponent(JSON.stringify({ customerRef }))}`,
                    'Gagal memuat limit piutang customer'
                );
                if (!cancelled) {
                    setCustomerCreditNotas(notaRows || []);
                }
            } catch (error) {
                if (!cancelled) {
                    setCustomerCreditNotas([]);
                    addToast('error', error instanceof Error ? error.message : 'Gagal memuat limit piutang customer');
                }
            } finally {
                if (!cancelled) {
                    setCustomerCreditLoading(false);
                }
            }
        };

        void loadCustomerCredit();
        return () => {
            cancelled = true;
        };
    }, [addToast, customerRef]);

    useEffect(() => {
        if (!customerScopedMastersLoaded || !shouldAutoApplyDefaultPickup || !customerRef || pickupStops.length === 0) {
            return;
        }
        // Only the primary customer's default pickup may seed the trip's first stop.
        const defaultPickup = findDefaultCustomerPickup(
            customerPickups.filter(pickup => pickup.customerRef === customerRef)
        );
        if (!defaultPickup) {
            setShouldAutoApplyDefaultPickup(false);
            return;
        }
        setPickupStops(previous => previous.map((stop, index) => (
            index === 0 ? applyCustomerPickupToStop(stop, defaultPickup) : stop
        )));
        setShouldAutoApplyDefaultPickup(false);
    }, [customerPickups, customerRef, customerScopedMastersLoaded, pickupStops.length, shouldAutoApplyDefaultPickup]);

    const handleCustomerChange = (nextCustomerRef: string) => {
        const nextCustomer = customers.find(customer => customer._id === nextCustomerRef);
        const defaultStop = createDefaultPickupStopForm(nextCustomer?.address || '');
        setCustomerRef(nextCustomerRef);
        // The customer just promoted to primary cannot also stay in the extras list.
        setAdditionalCustomerRefs(previous => previous.filter(ref => ref !== nextCustomerRef));
        setPickupStops([defaultStop]);
        setTripDrafts([]);
        setShouldAutoApplyDefaultPickup(Boolean(nextCustomerRef));
    };

    const addAdditionalCustomer = (nextCustomerRef: string) => {
        if (!nextCustomerRef || nextCustomerRef === customerRef) {
            return;
        }
        setAdditionalCustomerRefs(previous => (
            previous.includes(nextCustomerRef) ? previous : [...previous, nextCustomerRef]
        ));
    };

    const removeAdditionalCustomer = (targetCustomerRef: string) => {
        setAdditionalCustomerRefs(previous => previous.filter(ref => ref !== targetCustomerRef));
    };

    const updatePickupStop = <K extends keyof PickupStopForm>(index: number, field: K, value: PickupStopForm[K]) => {
        setPickupStops(previous => previous.map((stop, stopIndex) => (
            stopIndex === index ? { ...stop, [field]: value } : stop
        )));
    };

    const handlePickupStopMasterChange = (index: number, nextPickupRef: string) => {
        setPickupStops(previous => previous.map((stop, stopIndex) => (
            stopIndex === index
                ? applyCustomerPickupMasterSelection(stop, nextPickupRef, customerPickups)
                : stop
        )));
    };

    const handlePickupStopAddressChange = (index: number, value: string) => {
        setPickupStops(previous => previous.map((stop, stopIndex) => (
            stopIndex === index
                ? {
                    ...stop,
                    customerPickupRef: '',
                    pickupLabel: stop.customerPickupRef ? '' : stop.pickupLabel,
                    pickupAddress: value,
                }
                : stop
        )));
    };

    const addPickupStop = () => {
        setPickupStops(previous => [...previous, createDefaultPickupStopForm()]);
    };

    const removePickupStop = (index: number) => {
        setPickupStops(previous => {
            const removedStop = previous[index];
            const nextStops = previous.filter((_, stopIndex) => stopIndex !== index);
            setTripDrafts(currentTrips => currentTrips.map(trip => {
                const nextPickupStopKeys = trip.pickupStopKeys.filter(key => key !== removedStop?.id);
                return {
                    ...trip,
                    pickupStopKeys: nextPickupStopKeys.length > 0 ? nextPickupStopKeys : (nextStops[0] ? [nextStops[0].id] : []),
                };
            }));
            return nextStops.length > 0 ? nextStops : [createDefaultPickupStopForm(selectedCustomer?.address || '')];
        });
    };

    const updateTripDraft = <K extends keyof TripDraftForm>(index: number, field: K, value: TripDraftForm[K]) => {
        setTripDrafts(previous => previous.map((trip, tripIndex) => (
            tripIndex === index ? { ...trip, [field]: value } : trip
        )));
    };

    const toggleTripPickupStop = (index: number, pickupStopKey: string, checked: boolean) => {
        setTripDrafts(previous => previous.map((trip, tripIndex) => {
            if (tripIndex !== index) {
                return trip;
            }
            const nextPickupStopKeys = checked
                ? Array.from(new Set([...trip.pickupStopKeys, pickupStopKey]))
                : trip.pickupStopKeys.filter(value => value !== pickupStopKey);
            return {
                ...trip,
                pickupStopKeys: nextPickupStopKeys,
            };
        }));
    };

    const updateTripRouteSelection = (index: number, nextOriginArea: string, nextDestinationArea: string) => {
        setTripDrafts(previous => previous.map((trip, tripIndex) => (
            tripIndex === index
                ? (() => {
                    const matchedRate = resolveTripRateForDraft(trip, nextOriginArea, nextDestinationArea);
                    return {
                        ...trip,
                        tripOriginArea: nextOriginArea,
                        tripDestinationArea: nextDestinationArea,
                        tripRouteRateRef: matchedRate?._id || '',
                        tripFee: matchedRate?.rate || (shouldResetTripFeeForRoute(nextOriginArea, nextDestinationArea) ? 0 : trip.tripFee),
                    };
                })()
                : trip
        )));
    };

    const handleTripVehicleChange = (index: number, nextVehicleRef: string) => {
        setTripDrafts(previous => previous.map((trip, tripIndex) => {
            if (tripIndex !== index) {
                return trip;
            }
            const nextTrip = {
                ...trip,
                vehicleRef: nextVehicleRef,
            };
            const matchedRate = resolveTripRateForDraft(nextTrip, trip.tripOriginArea, trip.tripDestinationArea);
            const selectedVehicle = vehicles.find(vehicle => vehicle._id === nextVehicleRef) || null;
            const nextRequiresOverrideReason = Boolean(serviceRef && selectedVehicle && (!selectedVehicle.serviceRef || selectedVehicle.serviceRef !== serviceRef));
            return {
                ...nextTrip,
                vehicleOverrideReason: nextRequiresOverrideReason ? trip.vehicleOverrideReason : '',
                tripRouteRateRef: matchedRate?._id || '',
                tripFee: matchedRate?.rate || (shouldResetTripFeeForRoute(trip.tripOriginArea, trip.tripDestinationArea) ? 0 : trip.tripFee),
            };
        }));
    };

    const addTripDraft = () => {
        setTripDrafts(previous => [...previous, createDefaultTripDraftForm(pickupStops[0] ? [pickupStops[0].id] : [])]);
    };

    const removeTripDraft = (index: number) => {
        setTripDrafts(previous => previous.filter((_, tripIndex) => tripIndex !== index));
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!customerRef) {
            addToast('error', 'Customer wajib dipilih');
            return;
        }
        if (customerCreditUsage.isBlocked) {
            addToast('error', formatCustomerCreditBlockMessage(selectedCustomer?.name, customerCreditUsage));
            return;
        }
        // Wajib untuk semua order, termasuk yang trip-nya MITRA. Kolom
        // `orders.service_ref` NOT NULL di DB, dan untuk trip MITRA tidak ada
        // `vehicleRef` internal yang bisa dipakai sebagai fallback lookup tarif
        // rute (lihat getTripRouteServiceRef).
        if (!serviceRef) {
            addToast('error', 'Kategori Truk / Armada wajib dipilih');
            return;
        }

        const draftPickupStops = getDraftPickupStops(pickupStops);
        if (draftPickupStops.length === 0) {
            addToast('error', 'Minimal 1 titik pickup wajib diisi');
            return;
        }

        setLoading(true);
        try {
            const selectedCustomerRow = customers.find(customer => customer._id === customerRef);
            const selectedServiceRow = services.find(service => service._id === serviceRef);
            const payloadPickupStops = draftPickupStops.map((stop, index) => ({
                _key: stop.id,
                sequence: index + 1,
                customerPickupRef: stop.customerPickupRef || undefined,
                pickupLabel: stop.pickupLabel.trim() || undefined,
                pickupAddress: stop.pickupAddress.trim(),
                notes: stop.notes.trim() || undefined,
            }));
            const tripPayloads = tripDrafts.map((trip, index) => {
                const isMitraTrip = trip.tripOwnership === 'MITRA';
                const selectedTripVehicle = vehicles.find(vehicle => vehicle._id === trip.vehicleRef) || null;
                const requiresOverrideReason = Boolean(!isMitraTrip && serviceRef && selectedTripVehicle && (!selectedTripVehicle.serviceRef || selectedTripVehicle.serviceRef !== serviceRef));
                if (trip.pickupStopKeys.length === 0) {
                    throw new Error(`Minimal 1 titik pickup wajib dipilih pada trip ${index + 1}`);
                }
                if (!isMitraTrip) {
                    if (!trip.vehicleRef) {
                        throw new Error(`Kendaraan wajib dipilih pada trip ${index + 1}`);
                    }
                    if (!trip.driverRef) {
                        throw new Error(`Supir wajib dipilih pada trip ${index + 1}`);
                    }
                    if (!trip.issueBankRef) {
                        throw new Error(`Rekening atau kas sumber wajib dipilih pada trip ${index + 1}`);
                    }
                    if (!trip.cashGiven || trip.cashGiven <= 0) {
                        throw new Error(`Nominal uang jalan awal wajib diisi pada trip ${index + 1}`);
                    }
                    if (!trip.tripFee || trip.tripFee <= 0) {
                        throw new Error(`Upah trip wajib diisi pada trip ${index + 1}`);
                    }
                    if (requiresOverrideReason && !trip.vehicleOverrideReason.trim()) {
                        throw new Error(`Alasan override armada wajib diisi pada trip ${index + 1}`);
                    }
                }
                return {
                    tripOwnership: trip.tripOwnership,
                    pickupStopKeys: trip.pickupStopKeys,
                    vehicleRef: isMitraTrip ? '' : trip.vehicleRef,
                    driverRef: isMitraTrip ? '' : trip.driverRef,
                    tripRouteRateRef: isMitraTrip ? undefined : (trip.tripRouteRateRef || undefined),
                    tripOriginArea: trip.tripOriginArea || undefined,
                    tripDestinationArea: trip.tripDestinationArea || undefined,
                    taripBorongan: isMitraTrip ? 0 : trip.tripFee,
                    vehicleCategoryOverrideReason: isMitraTrip ? undefined : (trip.vehicleOverrideReason.trim() || undefined),
                    issueBankRef: isMitraTrip ? '' : trip.issueBankRef,
                    cashGiven: isMitraTrip ? 0 : trip.cashGiven,
                    notes: trip.notes.trim() || undefined,
                    date: trip.date,
                };
            });

            const response = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'orders',
                    action: 'create-with-items',
                    data: {
                        customerRef,
                        customerName: selectedCustomerRow?.name || '',
                        customerRefs: orderCustomerRefs.length > 1 ? orderCustomerRefs : undefined,
                        customerPickupRef: payloadPickupStops[0]?.customerPickupRef,
                        pickupAddress: payloadPickupStops[0]?.pickupAddress || '',
                        pickupStops: payloadPickupStops,
                        serviceRef,
                        serviceName: selectedServiceRow?.name || '',
                        notes,
                        items: [],
                        tripDrafts: tripPayloads,
                    },
                }),
            });

            const orderData = await response.json();
            if (!response.ok) {
                addToast('error', orderData.error || 'Gagal membuat order');
                return;
            }

            const orderId = orderData.data?._id || orderData.id;
            addToast(
                'success',
                `Order dibuat: ${orderData.data?.masterResi || ''}${Array.isArray(orderData.plannedTrips) && orderData.plannedTrips.length > 0 ? ` | ${orderData.plannedTrips.length} trip disimpan` : ''}`
            );
            router.push(`/orders/${orderId}`);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal membuat order');
        } finally {
            setLoading(false);
        }
    };

    const tripResourceAssignments = buildTripResourceAssignments({
        deliveryOrders: activeDeliveryOrders,
        orders: activeOrders,
    });

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <PageBackButton href="/orders" />
                    <h1 className="page-title">Buat Order Baru</h1>
                </div>
            </div>

            <form onSubmit={handleSubmit}>
                <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                    <div className="kpi-card">
                        <div className="kpi-content">
                            <div className="kpi-label">Customer</div>
                            <div className="kpi-value" style={{ fontSize: '1rem' }}>{selectedCustomer?.name || 'Belum dipilih'}</div>
                        </div>
                    </div>
                    <div className="kpi-card">
                        <div className="kpi-content">
                            <div className="kpi-label">Kategori Armada</div>
                            <div className="kpi-value" style={{ fontSize: '1rem' }}>{selectedService?.name || 'Opsional'}</div>
                            <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>{selectedServiceCapacityLabel}</div>
                        </div>
                    </div>
                    <div className="kpi-card">
                        <div className="kpi-content">
                            <div className="kpi-label">Pickup</div>
                            <div className="kpi-value" style={{ fontSize: '1rem' }}>{pickupSummary}</div>
                        </div>
                    </div>
                    <div className="kpi-card">
                        <div className="kpi-content">
                            <div className="kpi-label">Trip Awal</div>
                            <div className="kpi-value" style={{ fontSize: '0.95rem' }}>{tripDrafts.length} trip</div>
                        </div>
                    </div>
                </div>

                <div className="detail-grid">
                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Customer / Pengirim</span></div>
                        <div className="card-body">
                            <div className="form-group">
                                <label className="form-label">Customer / Pengirim / Penagih <span className="required">*</span></label>
                                                                <Combobox
                                    value={customerRef}
                                    onChange={(v: string) => handleCustomerChange(v)}
                                    options={customers.map(customer => ({ value: customer._id, label: customer.name }))}
                                    placeholder="Pilih customer"
                                    className="form-select"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Customer Tambahan (opsional)</label>
                                <Combobox
                                    value=""
                                    onChange={(v: string) => addAdditionalCustomer(v)}
                                    options={additionalCustomerOptions}
                                    placeholder={additionalCustomerOptions.length > 0
                                        ? 'Tambah customer lain'
                                        : 'Tidak ada customer lain yang bisa ditambahkan'}
                                    className="form-select"
                                    disabled={additionalCustomerOptions.length === 0}
                                />
                                {additionalCustomerRefs.length > 0 && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.5rem' }}>
                                        {additionalCustomerRefs.map(ref => {
                                            const additionalCustomer = customers.find(item => item._id === ref);
                                            return (
                                                <span key={ref} className="badge badge-info">
                                                    {additionalCustomer?.name || ref}
                                                    <button
                                                        type="button"
                                                        onClick={() => removeAdditionalCustomer(ref)}
                                                        aria-label={`Hapus customer ${additionalCustomer?.name || ref}`}
                                                        style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit', fontWeight: 700, lineHeight: 1 }}
                                                    >
                                                        ×
                                                    </button>
                                                </span>
                                            );
                                        })}
                                    </div>
                                )}
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                    Customer pertama tetap customer utama: pickup, barang, dan limit piutang mengikuti customer pertama.
                                    Tambahan hanya menandai trip ini melayani customer lain — penagihan tetap per SJ. Maksimal 5 customer.
                                </div>
                            </div>
                            {selectedCustomer && customerCreditUsage.isLimited && (
                                <div
                                    style={{
                                        border: `1px solid ${customerCreditUsage.isBlocked ? 'var(--color-danger)' : 'var(--color-warning)'}`,
                                        background: customerCreditUsage.isBlocked ? 'var(--color-danger-light)' : 'var(--color-warning-light)',
                                        color: customerCreditUsage.isBlocked ? 'var(--color-danger-dark)' : 'var(--color-warning-dark)',
                                        borderRadius: '0.8rem',
                                        padding: '0.8rem 0.9rem',
                                        marginBottom: '1rem',
                                        fontSize: '0.85rem',
                                        lineHeight: 1.5,
                                    }}
                                >
                                    <strong>{customerCreditUsage.isBlocked ? 'Order diblokir' : 'Limit piutang'}</strong>
                                    <div>
                                        Outstanding {formatCreditLimitCurrency(customerCreditUsage.outstandingAmount)} dari limit {formatCreditLimitCurrency(customerCreditUsage.limitAmount)}
                                        {customerCreditUsage.availableAmount !== null && !customerCreditUsage.isBlocked ? `, sisa ${formatCreditLimitCurrency(customerCreditUsage.availableAmount)}` : ''}.
                                    </div>
                                    {customerCreditLoading && <div className="text-muted text-sm">Memuat status invoice...</div>}
                                </div>
                            )}
                            <div className="form-group">
                                <label className="form-label">Kategori Truk / Armada <span className="required">*</span></label>
                                                                <Combobox
                                    value={serviceRef}
                                    onChange={(v: string) => {
                                        const nextServiceRef = v;
                                        setServiceRef(nextServiceRef);
                                        setTripDrafts(previous => previous.map(trip => {
                                            const effectiveRouteServiceRef = nextServiceRef || getVehicleServiceRef(trip.vehicleRef);
                                            const matchedRate = findMatchingTripRouteRate(tripRouteRates, {
                                                originArea: trip.tripOriginArea,
                                                destinationArea: trip.tripDestinationArea,
                                                serviceRef: effectiveRouteServiceRef,
                                            });
                                            const selectedVehicle = vehicles.find(vehicle => vehicle._id === trip.vehicleRef) || null;
                                            const nextRequiresOverrideReason = Boolean(nextServiceRef && selectedVehicle && (!selectedVehicle.serviceRef || selectedVehicle.serviceRef !== nextServiceRef));
                                            return {
                                                ...trip,
                                                vehicleOverrideReason: nextRequiresOverrideReason ? trip.vehicleOverrideReason : '',
                                                tripRouteRateRef: matchedRate?._id || '',
                                                tripFee: matchedRate?.rate || (shouldResetTripFeeForRoute(trip.tripOriginArea, trip.tripDestinationArea) ? 0 : trip.tripFee),
                                            };
                                        }));
                                    }}
                                    options={services.map(service => (
                                        { value: service._id, label: `${service.code} - ${service.name} (${serviceCapacityRangeMap[service._id] || 'Kapasitas belum diisi'})` }
                                    ))}
                                    placeholder="Pilih kategori armada"
                                    className="form-select"
                                />
                                {selectedService && (
                                    <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                                        {selectedServiceCapacityLabel}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Titik Pickup Order</span></div>
                        <div className="card-body" style={{ display: 'grid', gap: '0.9rem' }}>
                            {pickupStops.map((stop, index) => (
                                <div
                                    key={stop.id}
                                    style={{
                                        display: 'grid',
                                        gap: '0.85rem',
                                        padding: '1rem',
                                        border: '1px solid var(--color-gray-200)',
                                        borderRadius: '0.9rem',
                                        background: 'var(--color-gray-50)',
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                        <div style={{ fontWeight: 600 }}>Pickup {index + 1}</div>
                                        {pickupStops.length > 1 && (
                                            <button type="button" className="btn btn-ghost btn-icon-only" onClick={() => removePickupStop(index)} title="Hapus pickup">
                                                <X size={16} />
                                            </button>
                                        )}
                                    </div>
                                    {customerRef && (
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label">Master Pickup Customer</label>
                                                                                        <Combobox
                                                value={getPickupStopMasterValue(stop)}
                                                onChange={(v: string) => handlePickupStopMasterChange(index, v)}
                                                options={[
                                                    { value: MANUAL_PICKUP_MASTER_VALUE, label: MANUAL_PICKUP_MASTER_LABEL },
                                                    ...sortedCustomerPickups.map(pickup => (
                                                        {
                                                            value: pickup._id,
                                                            // With several customers on one order, name the owner so two
                                                            // "Gudang Utama" entries stay distinguishable.
                                                            label: `${pickup.isDefault ? '[Default] ' : ''}${pickup.label}${orderCustomerRefs.length > 1
                                                                ? ` — ${customers.find(customer => customer._id === pickup.customerRef)?.name || 'Customer lain'}`
                                                                : ''}`,
                                                        }
                                                    )),
                                                ]}
                                                placeholder={customerPickups.length > 0 ? 'Pilih master pickup, atau tulis manual' : 'Tulis manual di bawah'}
                                                className="form-select"
                                            />
                                        </div>
                                    )}
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">Alamat Pickup <span className="required">*</span></label>
                                        <textarea
                                            className="form-textarea"
                                            rows={2}
                                            value={stop.pickupAddress}
                                            onChange={event => handlePickupStopAddressChange(index, event.target.value)}
                                            placeholder="Alamat lokasi pengambilan barang"
                                        />
                                    </div>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">Catatan Pickup</label>
                                        <input
                                            className="form-input"
                                            value={stop.notes}
                                            onChange={event => updatePickupStop(index, 'notes', event.target.value)}
                                            placeholder="Catatan pickup"
                                        />
                                    </div>
                                </div>
                            ))}
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                <button type="button" className="btn btn-secondary btn-sm" onClick={addPickupStop}>
                                    <Plus size={14} /> Tambah Pickup
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card mt-6">
                    <div className="card-header">
                        <span className="card-header-title">Assign Trip di Order / Resi</span>
                    </div>
                    <div className="card-body" style={{ display: 'grid', gap: '1rem' }}>
                        {tripDrafts.length === 0 && (
                            <div style={{ fontSize: '0.85rem', color: 'var(--color-gray-600)', background: 'var(--color-gray-50)', border: '1px dashed var(--color-gray-300)', borderRadius: '0.75rem', padding: '1rem 1.1rem', lineHeight: 1.6 }}>
                                Belum ada trip. Order bisa langsung disimpan tanpa trip — kendaraan, supir, dan uang jalan bisa ditambahkan nanti dari halaman detail order.
                            </div>
                        )}
                        {tripDrafts.map((trip, index) => {
                            const isMitraTrip = trip.tripOwnership === 'MITRA';
                            const availableTripVehicles = vehicles
                                .slice()
                                .sort((left, right) => {
                                    const leftMatches = serviceRef && left.serviceRef === serviceRef ? 1 : 0;
                                    const rightMatches = serviceRef && right.serviceRef === serviceRef ? 1 : 0;
                                    if (leftMatches !== rightMatches) {
                                        return rightMatches - leftMatches;
                                    }
                                    return `${left.unitCode || ''} ${left.plateNumber || ''}`.localeCompare(`${right.unitCode || ''} ${right.plateNumber || ''}`, 'id');
                                });
                            const availableTripDrivers = drivers;
                            const selectedTripVehicle = vehicles.find(vehicle => vehicle._id === trip.vehicleRef) || null;
                            const requiresOverrideReason = Boolean(!isMitraTrip && serviceRef && selectedTripVehicle && (!selectedTripVehicle.serviceRef || selectedTripVehicle.serviceRef !== serviceRef));
                            const tripRouteServiceRef = serviceRef || selectedTripVehicle?.serviceRef || '';
                            const tripOriginAreaOptions = buildTripRateAreaOptions(tripRouteRates, 'originArea', { serviceRef: tripRouteServiceRef });
                            const tripDestinationAreaOptions = buildTripRateAreaOptions(tripRouteRates, 'destinationArea', { originArea: trip.tripOriginArea, serviceRef: tripRouteServiceRef });
                            const matchedTripRate = findMatchingTripRouteRate(tripRouteRates, {
                                originArea: trip.tripOriginArea,
                                destinationArea: trip.tripDestinationArea,
                                serviceRef: tripRouteServiceRef,
                            });
                            const isTripFeeLockedToMaster = Boolean(matchedTripRate);

                            return (
                                <div
                                    key={trip.id}
                                    style={{
                                        display: 'grid',
                                        gap: '0.95rem',
                                        padding: '1rem',
                                        border: '1px solid var(--color-gray-200)',
                                        borderRadius: '0.9rem',
                                        background: 'var(--color-gray-50)',
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                        <span style={{ fontWeight: 600 }}>Trip {index + 1}</span>
                                        {tripDrafts.length > 1 && (
                                            <button type="button" className="btn btn-ghost btn-icon-only" onClick={() => removeTripDraft(index)} title="Hapus trip">
                                                <X size={16} />
                                            </button>
                                        )}
                                    </div>

                                    {/* Baris sendiri, bukan sibling flex: lebar kotak ikut kolom
                                        form, bukan ikut panjang teks penjelasan. */}
                                    <TripOwnershipSwitch
                                        value={trip.tripOwnership}
                                        disabled={loading}
                                        onChange={value => updateTripDraft(index, 'tripOwnership', value)}
                                    />

                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">Pickup untuk Trip Ini <span className="required">*</span></label>
                                        <div style={{ display: 'grid', gap: '0.6rem' }}>
                                            {pickupStops.map((stop, pickupIndex) => (
                                                <label
                                                    key={stop.id}
                                                    style={{
                                                        display: 'grid',
                                                        gap: '0.2rem',
                                                        padding: '0.75rem 0.9rem',
                                                        borderRadius: '0.75rem',
                                                        border: trip.pickupStopKeys.includes(stop.id) ? '1px solid var(--color-primary)' : '1px solid var(--color-gray-200)',
                                                        background: trip.pickupStopKeys.includes(stop.id) ? 'var(--color-primary-50)' : 'var(--color-white)',
                                                        cursor: loading ? 'default' : 'pointer',
                                                    }}
                                                >
                                                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={trip.pickupStopKeys.includes(stop.id)}
                                                            onChange={event => toggleTripPickupStop(index, stop.id, event.target.checked)}
                                                            disabled={loading}
                                                        />
                                                        <span style={{ fontWeight: 600 }}>Pickup {pickupIndex + 1}{stop.pickupLabel ? ` · ${stop.pickupLabel}` : ''}</span>
                                                    </span>
                                                    <span className="text-muted text-sm">{stop.pickupAddress || '-'}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    {!isMitraTrip && (
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label className="form-label">Kendaraan <span className="required">*</span></label>
                                                                                        <Combobox
                                                value={trip.vehicleRef}
                                                onChange={(v: string) => handleTripVehicleChange(index, v)}
                                                options={availableTripVehicles.map(vehicle => (
                                                    { value: vehicle._id, label: `${vehicle.unitCode ? `${vehicle.unitCode} - ` : ''}${vehicle.plateNumber || vehicle._id}
                                                        ${vehicle.serviceName ? ` (${vehicle.serviceName})` : ''} | ${formatUnitCapacityLabel(vehicle)}`,
                                                      meta: (
                                                          <TripAssignmentDropdownMeta
                                                              assignments={tripVehicleAssignments(vehicle._id, tripResourceAssignments)}
                                                          />
                                                      ) }
                                                ))}
                                                placeholder="Pilih kendaraan"
                                                disabled={loading}
                                                className="form-select"
                                                allowCustomValue={false}
                                            />
                                            <TripResourceAssignmentBadges
                                                assignments={tripVehicleAssignments(trip.vehicleRef, tripResourceAssignments)}
                                                variant="list"
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Supir <span className="required">*</span></label>
                                                                                        <Combobox
                                                value={trip.driverRef}
                                                onChange={(v: string) => updateTripDraft(index, 'driverRef', v)}
                                                options={availableTripDrivers.map(driver => (
                                                    { value: driver._id, label: `${driver.name}${driver.phone ? ` - ${driver.phone}` : ''}`,
                                                      meta: (
                                                          <TripAssignmentDropdownMeta
                                                              assignments={tripDriverAssignments(driver._id, tripResourceAssignments)}
                                                          />
                                                      ) }
                                                ))}
                                                placeholder="Pilih supir"
                                                disabled={loading}
                                                className="form-select"
                                                allowCustomValue={false}
                                            />
                                            <TripResourceAssignmentBadges
                                                assignments={tripDriverAssignments(trip.driverRef, tripResourceAssignments)}
                                                variant="list"
                                            />
                                        </div>
                                    </div>
                                    )}

                                    {requiresOverrideReason && (
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label">Alasan Override Armada <span className="required">*</span></label>
                                            <textarea
                                                className="form-textarea"
                                                rows={2}
                                                value={trip.vehicleOverrideReason}
                                                onChange={event => updateTripDraft(index, 'vehicleOverrideReason', event.target.value)}
                                                placeholder="Mis. armada sesuai tidak tersedia atau load harus dipecah"
                                                disabled={loading}
                                            />
                                        </div>
                                    )}

                                    {!isMitraTrip && (
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label className="form-label">Asal Area Trip</label>
                                                                                        <Combobox
                                                value={trip.tripOriginArea}
                                                onChange={(v: string) => updateTripRouteSelection(index, v, '')}
                                                options={tripOriginAreaOptions.map(area => ({ value: area, label: area }))}
                                                placeholder="Pilih asal area"
                                                disabled={loading}
                                                className="form-select"
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Tujuan Area Trip</label>
                                                                                        <Combobox
                                                value={trip.tripDestinationArea}
                                                onChange={(v: string) => updateTripRouteSelection(index, trip.tripOriginArea, v)}
                                                options={tripDestinationAreaOptions.map(area => ({ value: area, label: area }))}
                                                placeholder="Pilih tujuan area"
                                                disabled={loading || !trip.tripOriginArea}
                                                className="form-select"
                                            />
                                        </div>
                                    </div>
                                    )}

                                    {!isMitraTrip && matchedTripRate && (
                                        <div style={{ fontSize: '0.8rem', color: 'var(--color-primary-700)', background: 'var(--color-primary-50)', border: '1px solid var(--color-primary-100)', padding: '0.75rem 0.9rem', borderRadius: '0.75rem' }}>
                                            Tarif master: {formatTripRouteRateLabel(matchedTripRate)} | {matchedTripRate.rate.toLocaleString('id-ID')}
                                        </div>
                                    )}

                                    <div className="form-row">
                                        {!isMitraTrip && (
                                        <div className="form-group">
                                            <label className="form-label">Upah Trip <span className="required">*</span></label>
                                            <FormattedNumberInput allowDecimal={false}
                                                value={isTripFeeLockedToMaster ? (matchedTripRate?.rate || 0) : trip.tripFee}
                                                onValueChange={value => updateTripDraft(index, 'tripFee', value)}
                                                placeholder="Isi upah trip"
                                                disabled={loading || isTripFeeLockedToMaster}
                                            />
                                        </div>
                                        )}
                                        <div className="form-group">
                                            <label className="form-label">Tanggal Trip</label>
                                            <input
                                                type="date"
                                                className="form-input"
                                                value={trip.date}
                                                onChange={event => updateTripDraft(index, 'date', event.target.value)}
                                                disabled={loading}
                                            />
                                        </div>
                                    </div>

                                    {!isMitraTrip && (
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label className="form-label">Kas / Bank Uang Jalan <span className="required">*</span></label>
                                                                                        <Combobox
                                                value={trip.issueBankRef}
                                                onChange={(v: string) => updateTripDraft(index, 'issueBankRef', v)}
                                                options={activeIssueBankAccounts.map(account => (
                                                    { value: account._id, label: `${account.bankName}${account.accountNumber ? ` - ${account.accountNumber}` : ''}` }
                                                ))}
                                                placeholder="Pilih sumber uang jalan"
                                                disabled={loading}
                                                className="form-select"
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Uang Jalan Awal <span className="required">*</span></label>
                                            <FormattedNumberInput allowDecimal={false}
                                                value={trip.cashGiven}
                                                onValueChange={value => updateTripDraft(index, 'cashGiven', value)}
                                                placeholder="Isi uang jalan awal"
                                                disabled={loading}
                                            />
                                        </div>
                                    </div>
                                    )}

                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">Catatan Trip</label>
                                        <input
                                            className="form-input"
                                            value={trip.notes}
                                            onChange={event => updateTripDraft(index, 'notes', event.target.value)}
                                            placeholder="Catatan opsional"
                                            disabled={loading}
                                        />
                                    </div>
                                </div>
                            );
                        })}

                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={addTripDraft}>
                                <Plus size={14} /> Tambah Trip
                            </button>
                        </div>
                    </div>
                </div>

                <div className="card mt-6">
                    <div className="card-body">
                        <div className="form-group">
                            <label className="form-label">Catatan Internal</label>
                            <textarea
                                className="form-textarea"
                                rows={3}
                                value={notes}
                                onChange={event => setNotes(event.target.value)}
                                placeholder="Catatan opsional..."
                            />
                        </div>
                    </div>
                    <div className="card-footer">
                        <button type="button" className="btn btn-secondary" onClick={() => router.push('/orders')}>Batal</button>
                        <button type="submit" className="btn btn-primary" disabled={loading || customerCreditUsage.isBlocked}>
                            <Save size={16} /> {loading ? 'Menyimpan...' : customerCreditUsage.isBlocked ? 'Limit Piutang Tercapai' : 'Simpan Order'}
                        </button>
                    </div>
                </div>
            </form>
        </div>
    );
}
