import type { PaymentMethod } from '@inscript-carte/shared';

import type { ApiResult } from '@/lib/api';

type ErrorCode = Extract<ApiResult<unknown>, { ok: false }>['error'];

/** Plain, friendly French for every error the API can return. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  network: 'Connexion impossible. Vérifiez votre connexion internet et réessayez.',
  not_found: "Ce concours ou cette inscription n'existe plus.",
  invalid_request: 'Le formulaire est incomplet. Vérifiez les champs et réessayez.',
  not_signed_in: 'Votre session a expiré. Merci de vous reconnecter.',
  invalid_credentials:
    'Ces informations ne correspondent à aucun licencié du club. Vérifiez le numéro de licence et la date de naissance sur votre licence.',
  too_many_attempts: 'Trop de tentatives. Réessayez dans quelques minutes.',
  registration_closed: "La date limite d'inscription par le club est passée.",
  already_registered: "Vous êtes déjà inscrit sur l'un de ces départs.",
  cannot_withdraw:
    "Cette inscription ne peut plus être retirée ici : la date limite est passée ou le club l'a déjà transmise. Contactez le club.",
  admin_sign_in_required: 'Votre session administrateur a expiré. Merci de retaper votre mot de passe.',
  not_admin: "Votre licence n'a pas accès à l'administration.",
  status_change_not_allowed:
    'Ce changement de statut est impossible : une inscription annulée le reste, et une inscription transmise ne revient pas à « Reçue ».',
  invalid_member_export: "Ce fichier n'est pas la liste des licenciés attendue.",
};

/** "À régler au club avant le 9 oct., par chèque, …" */
export const PAYMENT_METHOD_PHRASES: Record<PaymentMethod, string> = {
  cash: 'en espèces',
  cheque: 'par chèque',
  transfer: 'par virement',
};

/** `[1]` → "départ 1", `[1, 2, 3]` → "départs 1, 2 et 3". */
export function departuresPhrase(departures: readonly number[]): string {
  const numbers = departures.map(String);
  const list = numbers.length > 1 ? `${numbers.slice(0, -1).join(', ')} et ${numbers.at(-1)}` : numbers.join('');
  return `${numbers.length > 1 ? 'départs' : 'départ'} ${list}`;
}
