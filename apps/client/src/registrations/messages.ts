import type { PaymentMethod } from '@inscript-carte/shared';

import type { ApiResult } from '@/lib/api';

type ErrorCode = Extract<ApiResult<unknown>, { ok: false }>['error'];

/** Plain, friendly French for every error the API can return. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  network: 'Connexion impossible. Vérifiez votre connexion internet et réessayez.',
  not_found: "Ce concours ou cette inscription n'existe plus.",
  invalid_request: 'Le formulaire est incomplet. Vérifiez les champs et réessayez.',
  not_signed_in: 'Votre session a expiré. Merci de vous reconnecter.',
  invalid_credentials: 'Numéro de licence ou date de naissance incorrects. Vérifiez-les sur votre licence.',
  too_many_attempts: 'Trop de tentatives. Réessayez dans quelques minutes.',
  password_required: 'Votre compte est protégé par un mot de passe : saisissez-le pour vous connecter.',
  wrong_password: 'Mot de passe incorrect. En cas d’oubli, demandez à un responsable du club de le retirer.',
  same_password: 'Choisissez un mot de passe différent de l’actuel.',
  registration_closed:
    "Le club ne prend pas d'inscription pour ce concours en ce moment : la date limite est passée, le mandat n'est pas encore publié ou le concours est reporté.",
  already_registered: "Vous êtes déjà inscrit sur l'un de ces départs.",
  cannot_withdraw:
    "Cette inscription ne peut plus être retirée ici : la date limite est passée ou le club l'a déjà transmise. Contactez le club.",
  admin_sign_in_required: 'Vous n’avez plus accès à l’administration. Merci de vous reconnecter.',
  not_admin: "Vous n'avez pas accès à l'administration du club.",
  status_change_not_allowed: 'Une inscription annulée ne peut pas être réactivée : l’archer doit se réinscrire.',
  invalid_member_export: "Ce fichier n'est pas une liste de licenciés exportée de l'extranet FFTA.",
  password_change_required: 'Choisissez d’abord votre propre mot de passe.',
  password_too_short: 'Ce mot de passe est trop court : choisissez-en un plus long.',
  cannot_change_self: 'Vous ne pouvez pas faire cette action sur votre propre compte.',
  member_inactive: 'Ce licencié ne fait plus partie du club : réactivez-le d’abord.',
  already_admin: 'Ce licencié est déjà administrateur.',
  admin_needs_password:
    'Un administrateur garde toujours un mot de passe : il sert aussi pour l’administration. Il peut le changer, pas le retirer.',
  scraper_busy: 'Une mise à jour du calendrier FFTA est déjà en cours. Attendez qu’elle se termine.',
  scraper_unavailable:
    'La mise à jour du calendrier FFTA n’est pas possible sur ce serveur (navigateur non installé). Prévenez la personne qui gère le serveur.',
  credit_too_low:
    'Votre avoir ne suffit pas pour payer ce concours. Choisissez un autre mode de paiement : votre avoir reste disponible.',
  credit_price_unknown:
    'Le prix de ce concours n’est pas connu, votre avoir ne peut donc pas servir ici. Choisissez un autre mode de paiement.',
  credit_already_used: 'L’archer a déjà utilisé cet avoir pour une autre inscription : il ne peut plus être retiré.',
};

/** "À régler au club avant le 9 oct., par chèque, …" */
export const PAYMENT_METHOD_PHRASES: Record<PaymentMethod, string> = {
  cash: 'en espèces',
  cheque: 'par chèque',
  transfer: 'par virement',
  credit: 'avec votre avoir',
};

/** `[1]` → "départ 1", `[1, 2, 3]` → "départs 1, 2 et 3". */
export function departuresPhrase(departures: readonly number[]): string {
  const numbers = departures.map(String);
  const list = numbers.length > 1 ? `${numbers.slice(0, -1).join(', ')} et ${numbers.at(-1)}` : numbers.join('');
  return `${numbers.length > 1 ? 'départs' : 'départ'} ${list}`;
}
