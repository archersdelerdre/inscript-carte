import {
  ageCategory,
  apiPath,
  API_ROUTES,
  BOW_TYPE_LABELS,
  BOW_TYPES,
  categoryLabel,
  DISTANCE_LABELS,
  DISTANCES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type BowType,
  type CompetitionDto,
  type Distance,
  type PaymentMethod,
  type ListMyRegistrationsResponse,
  type RegistrationCreatedResponse,
  type RegistrationRequest,
  type SignedInArcher,
} from '@inscript-carte/shared';
import { CheckIcon, FileTextIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useSession } from '@/auth/session';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { api } from '@/lib/api';
import { formatDateRange, formatDay } from '@/lib/dates';
import { cn } from '@/lib/utils';

import { departureOptions } from './departures';
import { departuresPhrase, ERROR_MESSAGES, PAYMENT_METHOD_PHRASES } from './messages';

/** Remembered on the device so the next registration is pre-filled ("never ask twice"). */
const STORAGE = {
  bowType: 'registration.bowType',
  contact: 'registration.contact',
  paymentMethod: 'registration.paymentMethod',
} as const;

type Props = {
  competition: CompetitionDto;
  archer: SignedInArcher;
  onClose: () => void;
  onRegistered: () => void;
};

export function RegistrationFormDialog({ competition, archer, onClose, onRegistered }: Props) {
  const { sessionExpired } = useSession();
  const [departures, setDepartures] = useState<string[]>([]);
  const [taken, setTaken] = useState<number[]>([]);
  const [bowType, setBowType] = useState<BowType>(
    () => BOW_TYPES.find((value) => value === localStorage.getItem(STORAGE.bowType)) ?? 'classique',
  );
  /** Rare case: a different bow on some départs. `null` = the same bow everywhere (the usual case). */
  const [bowByDeparture, setBowByDeparture] = useState<Record<string, BowType> | null>(null);
  const [distance, setDistance] = useState<Distance | ''>('');
  const [trispot, setTrispot] = useState(false);
  // Not remembered on the device (it depends on each competition); ticked again below for another départ of the
  // same competition.
  const [carpool, setCarpool] = useState(false);
  const [contact, setContact] = useState(() => localStorage.getItem(STORAGE.contact) ?? '');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>(
    () => PAYMENT_METHODS.find((value) => value === localStorage.getItem(STORAGE.paymentMethod)) ?? '',
  );
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [created, setCreated] = useState<RegistrationCreatedResponse | null>(null);

  const isExterieur = competition.discipline === 'exterieur';
  const category = categoryLabel(ageCategory(archer.birthYear, competition.startDate), archer.sex);
  const options = departureOptions(competition);
  const fromMandate = competition.departures !== null;
  const nameOf = (departure: string) => options.find(({ number }) => String(number) === departure)?.name ?? departure;
  const sortedDepartures = departures.toSorted((a, b) => Number(a) - Number(b));
  const bowPerDeparture = bowByDeparture !== null && departures.length >= 2;
  const bowFor = (departure: string) => (bowPerDeparture ? (bowByDeparture[departure] ?? bowType) : bowType);

  // Départs this archer already has: shown as taken instead of failing on submit. Covoiturage is ticked again if
  // they already said yes for this competition: the archer is the same person for every départ.
  useEffect(() => {
    void api<ListMyRegistrationsResponse>(API_ROUTES.myRegistrations).then((result) => {
      if (!result.ok) return;
      // "Mon suivi" only lists active départs.
      const mine = result.data.registrations.filter((registration) => registration.competitionId === competition.id);
      setTaken(mine.map((registration) => registration.departure));
      if (mine.some((registration) => registration.carpool)) setCarpool(true);
    });
  }, [competition.id]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const missing = [
      departures.length === 0 && 'le ou les départs',
      isExterieur && !distance && 'les distances',
      !paymentMethod && 'le mode de paiement',
    ].filter(Boolean);
    // `!paymentMethod` is already in `missing`; repeated so TypeScript knows it is set below.
    if (missing.length > 0 || !paymentMethod) return setMessage(`Merci d'indiquer : ${missing.join(', ')}.`);

    setSending(true);
    const request: RegistrationRequest = {
      departures: sortedDepartures.map((departure) => ({ departure: Number(departure), bowType: bowFor(departure) })),
      trispot,
      carpool,
      distance: isExterieur && distance ? distance : null,
      contact: contact.trim() || null,
      paymentMethod,
    };
    const result = await api<RegistrationCreatedResponse>(
      apiPath(API_ROUTES.competitionRegistrations, { competitionId: competition.id }),
      { method: 'POST', body: request },
    );
    setSending(false);
    if (!result.ok) {
      if (result.error === 'not_signed_in') sessionExpired();
      return setMessage(ERROR_MESSAGES[result.error]);
    }
    localStorage.setItem(STORAGE.bowType, bowType);
    localStorage.setItem(STORAGE.contact, contact.trim());
    localStorage.setItem(STORAGE.paymentMethod, paymentMethod);
    setCreated(result.data);
    onRegistered();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>S'inscrire : {competition.title}</DialogTitle>
          {/* No final period after the deadline: the short month already ends with one ("9 oct."). */}
          <DialogDescription>
            {formatDateRange(competition.startDate, competition.endDate)}, {competition.town}. Inscription par le club
            jusqu'au {formatDay(competition.clubRegistrationDeadline)}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <>
            <div role='status' className='grid gap-2 rounded-md bg-green-50 px-4 py-3 text-green-950'>
              <p className='font-semibold'>
                {created.departures.length > 1 ? 'Inscriptions enregistrées' : 'Inscription enregistrée'} (
                {departuresPhrase(created.departures)}).
              </p>
              <p>
                À régler au club avant le {formatDay(created.paymentDeadline)}
                {paymentMethod && `, ${PAYMENT_METHOD_PHRASES[paymentMethod]}`}, en indiquant la référence{' '}
                <strong>{created.paymentReference}</strong>.
              </p>
              <p>Vous retrouverez cette inscription et sa référence dans « Mon suivi ».</p>
            </div>
            <DialogFooter>
              <Button onClick={onClose}>Fermer</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className='grid gap-5' noValidate>
            <p className='bg-muted rounded-md px-3 py-2'>
              {archer.fullName} · <span className='text-muted-foreground'>Catégorie</span> {category}
            </p>

            <fieldset className='grid gap-2'>
              <legend className='mb-2 flex items-baseline gap-3 font-medium'>
                Départ(s) souhaité(s)
                {competition.mandateUrl && (
                  <a
                    href={competition.mandateUrl}
                    target='_blank'
                    rel='noopener'
                    className='text-muted-foreground inline-flex items-center gap-1 self-center text-sm font-normal underline'
                  >
                    <FileTextIcon className='size-4' aria-hidden />
                    Mandat
                  </a>
                )}
              </legend>
              <ToggleGroup
                type='multiple'
                variant='outline'
                value={departures}
                onValueChange={setDepartures}
                className={cn(fromMandate ? 'grid grid-cols-1 gap-2 sm:grid-cols-2' : 'flex-wrap')}
              >
                {options.map(({ number, name, details }) => (
                  <ToggleGroupItem
                    key={number}
                    value={String(number)}
                    disabled={taken.includes(number)}
                    aria-label={details ? `${name}, ${details}` : name}
                    className={cn(
                      'border-input data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground',
                      fromMandate
                        ? 'h-auto min-h-14 min-w-0 justify-start gap-2 px-3 py-2 text-left whitespace-normal'
                        : 'min-w-12',
                    )}
                  >
                    {departures.includes(String(number)) && <CheckIcon />}
                    {fromMandate ? (
                      <span className='grid'>
                        <span className='text-base font-medium'>{name}</span>
                        {details && <span className='text-sm font-normal'>{details}</span>}
                      </span>
                    ) : (
                      number
                    )}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <p className='text-muted-foreground text-sm'>
                {taken.length > 0 &&
                  `Vous êtes déjà inscrit${archer.sex === 'female' ? 'e' : ''} (${departuresPhrase(taken)}). `}
                {fromMandate && 'Départs et horaires repris du mandat.'}
                {!fromMandate && !competition.mandateUrl && 'Le mandat n’est pas encore publié. '}
                {!fromMandate &&
                  'Le nombre de départs n’est pas encore connu : une inscription sur un départ qui n’existe pas pourra être annulée.'}
              </p>
            </fieldset>

            {bowPerDeparture ? (
              <fieldset className='grid gap-2'>
                <legend className='mb-1 font-medium'>Arc pour chaque départ</legend>
                {sortedDepartures.map((departure) => (
                  <div key={departure} className='flex items-center justify-between gap-3'>
                    <span>{nameOf(departure)}</span>
                    <Select
                      value={bowFor(departure)}
                      onValueChange={(value) => setBowByDeparture({ ...bowByDeparture, [departure]: value as BowType })}
                    >
                      <SelectTrigger aria-label={`Arc pour : ${nameOf(departure)}`} className='w-48'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BOW_TYPES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {BOW_TYPE_LABELS[value]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                <Button
                  type='button'
                  variant='link'
                  className='text-muted-foreground w-fit border-0 px-0'
                  onClick={() => setBowByDeparture(null)}
                >
                  Même arc pour tous les départs
                </Button>
              </fieldset>
            ) : (
              <div className='grid gap-1'>
                <ChoiceGroup
                  legend='Arc'
                  name='bow-type'
                  value={bowType}
                  onChange={(value) => setBowType(value as BowType)}
                  options={BOW_TYPES.map((value) => [value, BOW_TYPE_LABELS[value]])}
                />
                {departures.length >= 2 && (
                  <Button
                    type='button'
                    variant='link'
                    className='text-muted-foreground w-fit border-0 px-0'
                    onClick={() =>
                      setBowByDeparture(Object.fromEntries(departures.map((departure) => [departure, bowType])))
                    }
                  >
                    Un arc différent selon le départ ?
                  </Button>
                )}
              </div>
            )}

            {isExterieur && (
              <ChoiceGroup
                legend='Distances'
                name='distance'
                value={distance}
                onChange={(value) => setDistance(value as Distance)}
                options={DISTANCES.map((value) => [value, DISTANCE_LABELS[value]])}
              />
            )}

            <Label htmlFor='trispot' className='min-h-10 cursor-pointer'>
              <Checkbox id='trispot' checked={trispot} onCheckedChange={(checked) => setTrispot(checked === true)} />
              Je souhaite tirer sur trispot
            </Label>

            <Label htmlFor='carpool' className='min-h-10 cursor-pointer'>
              <Checkbox id='carpool' checked={carpool} onCheckedChange={(checked) => setCarpool(checked === true)} />
              Je suis intéressé(e) par un covoiturage depuis le club
            </Label>

            <div className='grid gap-2'>
              <Label htmlFor='payment-method'>Mode de paiement</Label>
              <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}>
                <SelectTrigger id='payment-method' className='w-full'>
                  <SelectValue placeholder='Choisir…' />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {PAYMENT_METHOD_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className='grid gap-2'>
              <Label htmlFor='contact'>
                Téléphone ou e-mail <span className='text-muted-foreground font-normal'>(facultatif)</span>
              </Label>
              <Input
                id='contact'
                value={contact}
                onChange={(event) => setContact(event.target.value)}
                autoComplete='tel'
                maxLength={200}
              />
            </div>

            {message && (
              <p role='alert' className='rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900'>
                {message}
              </p>
            )}
            <DialogFooter>
              <Button type='button' variant='outline' onClick={onClose}>
                Annuler
              </Button>
              <Button type='submit' disabled={sending}>
                {sending ? 'Envoi…' : 'Envoyer mon inscription'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

type ChoiceGroupProps = {
  legend: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: [value: string, label: string][];
};

/** Radio buttons whose whole row is clickable (40 px tall). */
function ChoiceGroup({ legend, name, value, onChange, options }: ChoiceGroupProps) {
  return (
    <fieldset className='grid gap-1'>
      <legend className='mb-1 font-medium'>{legend}</legend>
      <RadioGroup value={value} onValueChange={onChange} className='grid gap-0 sm:grid-cols-2'>
        {options.map(([optionValue, label]) => (
          <Label
            key={optionValue}
            htmlFor={`${name}-${optionValue}`}
            className='hover:bg-muted min-h-10 cursor-pointer rounded-md px-1 font-normal'
          >
            <RadioGroupItem id={`${name}-${optionValue}`} value={optionValue} />
            {label}
          </Label>
        ))}
      </RadioGroup>
    </fieldset>
  );
}
