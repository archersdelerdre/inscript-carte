import type { ApiResult } from '@/lib/api';

type ErrorCode = Extract<ApiResult<unknown>, { ok: false }>['error'];

/** Plain, friendly French for every error the API can return. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  network: 'Connexion impossible. Vérifiez votre connexion internet et réessayez.',
  not_found: "Ce concours ou cette inscription n'existe plus.",
  invalid_request: 'Le formulaire est incomplet. Vérifiez les champs et réessayez.',
  not_signed_in: 'Votre session a expiré. Merci de vous reconnecter.',
  invalid_credentials:
    'Numéro de licence ou date de naissance incorrect. Vérifiez sur votre licence. Seuls les licenciés du club peuvent se connecter.',
  too_many_attempts: "Trop d'essais. Réessayez un peu plus tard.",
  registration_closed: "La date limite d'inscription par le club est passée.",
  already_registered: 'Vous êtes déjà inscrit à au moins un de ces départs.',
  cannot_withdraw:
    'Cette inscription ne peut plus être retirée ici (date limite passée ou déjà transmise par le club). Contactez le club.',
};
